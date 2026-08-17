import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "./atoms/Box";
import { EndOfList } from "./atoms/EndOfList";
import { Modal } from "./atoms/Modal";
import { STORYBOOK_BRAND_COLOR, StorybookIcon } from "./atoms/StorybookIcon";
import { TabBar, type TabBarTab } from "./atoms/TabBar";
import { Typo } from "./atoms/Typo";
import { CaptureErrorsModal } from "./components/CaptureErrorsModal";
import { CompareModal } from "./components/CompareModal";
import { ContentPanel } from "./components/ContentPanel";
import { DeletedItemRow } from "./components/DeletedItemRow";
import { DraggableSplitView } from "./components/DraggableSplitView";
import { ErrorState } from "./components/ErrorState";
import { TreePanel } from "./components/TreePanel";
import { VisualRegressionTopBar } from "./components/VisualRegressionTopBar";
import {
  createInitialTabStates,
  useAllStoriesTree,
  useCaptureErrors,
  useDeletedRegressions,
  useDevicesConfig,
  useOrphansTree,
  usePixelDiffMetrics,
  useRegressionTrees,
  useValidatedRegressions,
} from "./hooks/useVisualRegressionData";
import { DeviceConfigProvider } from "./providers/DeviceConfigProvider";
import { colors, spacing } from "./themes/theme";
import type { DeviceDisplayConfig, Node, StoryScreenshotsPath } from "./types/types";
import {
  createVisualRegressionActions,
  filterTree,
  flattenTreeVisual,
  isSelectableTreeFile,
  togglePaths,
  type StatusFilterValue,
  type TreePanelMode,
} from "./utils";

export type VisualRegressionsProps = {
  /** Config d'affichage des devices (label, icon, color). Optionnel : si absent, récupérée depuis le serveur VR (GET /regressions/config/devices, depuis vr.config.cjs). */
  devices?: DeviceDisplayConfig[];
};

export const VisualRegressions = ({ devices: devicesProp }: VisualRegressionsProps) => {
  const [leftTab, setLeftTab] = useState<TreePanelMode>("regressions");
  const [tabStates, setTabStates] = useState(createInitialTabStates);
  const [showDeleted, setShowDeleted] = useState(false);
  const [historyTab, setHistoryTab] = useState<"rejected" | "validated">("rejected");
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showCaptureErrorsModal, setShowCaptureErrorsModal] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [pendingRestorePath, setPendingRestorePath] = useState<string | undefined>();
  const [bulkLoading, setBulkLoading] = useState(false);
  /** Path à sélectionner après validate/refuse — figé AVANT l’API pour survivre au SSE. */
  const pendingSelectPathRef = useRef<string | null>(null);

  const { searchQuery, statusFilter, selectedPath, multiSelectMode, selectedPaths } = tabStates[leftTab];

  const setSelectedPath = useCallback(
    (path: string | undefined) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: { ...prev[leftTab], selectedPath: path },
      }));
    },
    [leftTab],
  );

  const setSearchQuery = useCallback(
    (query: string) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: { ...prev[leftTab], searchQuery: query },
      }));
    },
    [leftTab],
  );

  const setStatusFilter = useCallback(
    (statuses: Set<StatusFilterValue>) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: { ...prev[leftTab], statusFilter: statuses },
      }));
    },
    [leftTab],
  );

  const setMultiSelectMode = useCallback(
    (enabled: boolean) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: {
          ...prev[leftTab],
          multiSelectMode: enabled,
          // Sortie du mode → vide la sélection de l’onglet.
          selectedPaths: enabled ? prev[leftTab].selectedPaths : new Set(),
        },
      }));
    },
    [leftTab],
  );

  const clearSelectedPaths = useCallback(() => {
    setTabStates(prev => ({
      ...prev,
      [leftTab]: { ...prev[leftTab], selectedPaths: new Set() },
    }));
  }, [leftTab]);

  const { devices, loading: devicesLoading, error: devicesError } = useDevicesConfig(devicesProp);
  const {
    tree: regressionsTree,
    lastUpdate,
    loading: regressionsLoading,
    error: treeError,
    refresh: refreshRegressions,
  } = useRegressionTrees();
  const {
    tree: allStoriesTree,
    storyCount,
    fingerprint: allStoriesFingerprint,
    loading: allStoriesLoading,
    refresh: refreshAllStories,
  } = useAllStoriesTree();
  const {
    tree: orphansTree,
    countTotal: orphansCountTotal,
    fingerprint: orphansFingerprint,
    loading: orphansLoading,
    refresh: refreshOrphans,
  } = useOrphansTree();
  const { deletedList, refresh: refreshDeleted } = useDeletedRegressions();
  const { validatedList, refresh: refreshValidated } = useValidatedRegressions();
  const { errors: captureErrors, refresh: refreshCaptureErrors } = useCaptureErrors();

  /** Si l’onglet orphelins disparaît (count → 0) alors qu’il était actif → régressions. */
  useEffect(() => {
    if (leftTab === "orphans" && orphansCountTotal === 0) {
      setLeftTab("regressions");
    }
  }, [leftTab, orphansCountTotal]);

  /**
   * Fraîcheur catalogue / orphelins : fetch immédiat au switch d’onglet (silencieux).
   * Anti-rebuild via fingerprint côté hook — pas de poll.
   */
  useEffect(() => {
    if (leftTab === "all-stories") {
      void refreshAllStories({ silent: true });
      return;
    }
    if (leftTab === "orphans") {
      void refreshOrphans({ silent: true });
    }
  }, [leftTab, refreshAllStories, refreshOrphans]);

  const activeTree = useMemo(() => {
    if (leftTab === "all-stories") return allStoriesTree;
    if (leftTab === "orphans") return orphansTree;
    return regressionsTree;
  }, [leftTab, allStoriesTree, orphansTree, regressionsTree]);

  /** Arbre filtré (search + chips) — utilisé pour sélection / navigation de l’onglet actif. */
  const filteredTree = useMemo(
    () =>
      filterTree(activeTree, {
        query: searchQuery,
        statuses: statusFilter,
        mode: leftTab,
      }),
    [activeTree, searchQuery, statusFilter, leftTab],
  );

  const activeLoading =
    leftTab === "all-stories" ? allStoriesLoading : leftTab === "orphans" ? orphansLoading : regressionsLoading;

  /** Bouton TreePanel : catalogue/orphelins = GET forcé ; régressions = rebuild index. */
  const refreshActive = useCallback(() => {
    if (leftTab === "all-stories") return refreshAllStories({ force: true });
    if (leftTab === "orphans") return refreshOrphans({ force: true });
    return refreshRegressions();
  }, [leftTab, refreshAllStories, refreshOrphans, refreshRegressions]);

  /** Compteurs tabs = nœuds fichier avant search/filtre UI. */
  const regressionsCount = regressionsTree?.countTotal ?? 0;
  const catalogCount = allStoriesTree?.countTotal ?? storyCount;

  const leftTabs = useMemo<TabBarTab<TreePanelMode>[]>(
    () => [
      {
        key: "regressions",
        title: "Régressions",
        shortTitle: "VR",
        bullet: { value: regressionsCount, color: regressionsCount > 0 ? "newTheme_danger" : "newTheme_primary" },
      },
      {
        key: "all-stories",
        title: "Stories",
        renderIcon: ({ selected }) => (
          <StorybookIcon
            color={selected ? colors.newTheme_textOnPrimary : STORYBOOK_BRAND_COLOR}
            markColor={selected ? colors.newTheme_primary : "#FFFFFF"}
          />
        ),
        bullet: { value: catalogCount, color: "newTheme_storybook" },
      },
      {
        key: "orphans",
        title: "Orphelins",
        icon: { name: "link-off" },
        bullet: { value: orphansCountTotal, color: "newTheme_warning" },
        disabled: orphansCountTotal === 0,
      },
    ],
    [regressionsCount, catalogCount, orphansCountTotal],
  );

  const allList = useMemo(() => flattenTreeVisual(filteredTree), [filteredTree]);

  const handleTogglePath = useCallback(
    (path: string) => {
      const node = allList.find(n => n.path === path);
      if (node && !isSelectableTreeFile(node)) return;
      setTabStates(prev => ({
        ...prev,
        [leftTab]: {
          ...prev[leftTab],
          selectedPaths: togglePaths(prev[leftTab].selectedPaths, [path]),
        },
      }));
    },
    [leftTab, allList],
  );

  const handleTogglePaths = useCallback(
    (paths: readonly string[]) => {
      const selectablePaths = paths.filter(path => {
        const node = allList.find(n => n.path === path);
        return node ? isSelectableTreeFile(node) : false;
      });
      if (selectablePaths.length === 0) return;
      setTabStates(prev => ({
        ...prev,
        [leftTab]: {
          ...prev[leftTab],
          selectedPaths: togglePaths(prev[leftTab].selectedPaths, selectablePaths),
        },
      }));
    },
    [leftTab, allList],
  );

  const handleSelectPaths = useCallback(
    (paths: readonly string[]) => {
      const selectablePaths = paths.filter(path => {
        const node = allList.find(n => n.path === path);
        return node ? isSelectableTreeFile(node) : false;
      });
      if (selectablePaths.length === 0) return;
      setTabStates(prev => {
        const next = new Set(prev[leftTab].selectedPaths);
        for (const path of selectablePaths) next.add(path);
        return {
          ...prev,
          [leftTab]: {
            ...prev[leftTab],
            multiSelectMode: true,
            selectedPaths: next,
          },
        };
      });
    },
    [leftTab, allList],
  );

  /** Élaguer les paths absents de l’arbre filtré (refresh SSE / filtre) ou non sélectionnables (ignore-vr). */
  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const visibleSelectable = new Set(allList.filter(isSelectableTreeFile).map(n => n.path));
    let changed = false;
    const next = new Set<string>();
    for (const path of selectedPaths) {
      if (visibleSelectable.has(path)) next.add(path);
      else changed = true;
    }
    if (!changed) return;
    setTabStates(prev => ({
      ...prev,
      [leftTab]: { ...prev[leftTab], selectedPaths: next },
    }));
  }, [allList, leftTab, selectedPaths]);

  const currentStory = useMemo(
    () => (selectedPath ? allList.find(n => n.path === selectedPath) : undefined),
    [allList, selectedPath],
  );

  const storyType = currentStory?.storyType;
  const treeType = useMemo<"new" | "diff">(() => {
    return storyType === "diff" ? "diff" : "new";
  }, [storyType]);

  const imageUrls = useMemo<StoryScreenshotsPath>(
    () => currentStory?.imageUrls || { original: undefined, temp: undefined, diff: undefined, new: undefined },
    [currentStory],
  );

  const storyScreenshotsPath = useMemo<StoryScreenshotsPath | undefined>(
    () => currentStory?.imagePaths,
    [currentStory],
  );

  const contentKey = useMemo(() => {
    const path = selectedPath ?? "";
    if (leftTab === "all-stories") return `${path}-${allStoriesFingerprint ?? ""}`;
    if (leftTab === "orphans") return `${path}-${orphansFingerprint ?? ""}`;
    return `${path}-${lastUpdate}`;
  }, [selectedPath, leftTab, allStoriesFingerprint, orphansFingerprint, lastUpdate]);

  const goTo = useCallback(
    (node: Node) => {
      setSelectedPath(node.path);
    },
    [setSelectedPath],
  );

  const goNext = useCallback(() => {
    if (!allList.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath) {
      setSelectedPath(allList[0].path);
      return;
    }
    const index = allList.findIndex(n => n.path === selectedPath);
    if (index !== -1 && index < allList.length - 1) {
      setSelectedPath(allList[index + 1].path);
    } else {
      setSelectedPath(allList[0].path);
    }
  }, [allList, selectedPath, setSelectedPath]);

  const goPrev = useCallback(() => {
    if (!allList.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath) {
      setSelectedPath(allList[0].path);
      return;
    }
    const index = allList.findIndex(n => n.path === selectedPath);
    if (index > 0) {
      setSelectedPath(allList[index - 1].path);
    } else {
      setSelectedPath(allList[allList.length - 1].path);
    }
  }, [allList, selectedPath, setSelectedPath]);

  /** Calcule le path suivant à partir de la liste courante (avant retrait SSE). */
  const prepareAdvanceAfterRemove = useCallback(() => {
    const deletedPath = selectedPath;
    if (!deletedPath || allList.length === 0) {
      pendingSelectPathRef.current = null;
      return;
    }
    const index = allList.findIndex(n => n.path === deletedPath);
    const remaining = allList.filter(n => n.path !== deletedPath);
    if (remaining.length === 0) {
      pendingSelectPathRef.current = null;
      return;
    }
    // Après suppression de l’index i : l’ex-i+1 est à i. Si i était le dernier → boucle sur [0].
    const nextIndex = index === -1 ? 0 : index < remaining.length ? index : 0;
    const nextPath = remaining[nextIndex].path;
    pendingSelectPathRef.current = nextPath;
    // Optimistic : bascule tout de suite (storyScreenshotsPath déjà capturé par l’appelant)
    setSelectedPath(nextPath);
  }, [allList, selectedPath, setSelectedPath]);

  /** Après succès API : ré-applique le pending (no-op si déjà appliqué). */
  const advanceAfterDelete = useCallback(() => {
    const nextPath = pendingSelectPathRef.current;
    if (nextPath) {
      setSelectedPath(nextPath);
    }
  }, [setSelectedPath]);

  const focusRestoredStory = useCallback((fullPath: string) => {
    setPendingRestorePath(fullPath);
  }, []);

  useEffect(() => {
    if (!pendingRestorePath) return;
    const match = allList.find(n => n.path === pendingRestorePath);
    if (match) {
      setSelectedPath(match.path);
      setPendingRestorePath(undefined);
    }
  }, [pendingRestorePath, allList, setSelectedPath]);

  useEffect(() => {
    if (pendingRestorePath) return;
    const pending = pendingSelectPathRef.current;
    if (pending) {
      // Garder le pending jusqu’à ce que le tree SSE le contienne (ou liste vide)
      if (allList.length === 0) {
        pendingSelectPathRef.current = null;
        setSelectedPath(undefined);
        return;
      }
      if (allList.some(n => n.path === pending)) {
        if (selectedPath !== pending) setSelectedPath(pending);
        pendingSelectPathRef.current = null;
      }
      // Tant que pending existe : ne jamais forcer allList[0]
      return;
    }
    if (!selectedPath && allList.length > 0) {
      setSelectedPath(allList[0].path);
      return;
    }
    if (selectedPath && allList.length > 0 && !allList.some(n => n.path === selectedPath)) {
      setSelectedPath(allList[0].path);
    }
  }, [selectedPath, allList, pendingRestorePath, setSelectedPath]);

  const {
    handleValid,
    handleValidAll,
    handleValidSelected,
    handleCompareStory,
    handleCompareSelected,
    handleCompareByType,
    handleCompareAllStories,
    handleDelete,
    handleDeleteAll,
    handleDeleteSelected,
    handleRestore,
    handleRevertValidated,
  } = createVisualRegressionActions({
    onBeforeRemove: prepareAdvanceAfterRemove,
    onAfterDelete: advanceAfterDelete,
    onAfterRestore: focusRestoredStory,
    onAfterBulk: () => {
      pendingSelectPathRef.current = null;
      setSelectedPath(undefined);
      clearSelectedPaths();
    },
  });

  const runBulk = useCallback(async (action: () => Promise<void>) => {
    setBulkLoading(true);
    try {
      await action();
    } finally {
      setBulkLoading(false);
    }
  }, []);

  const [regeneratingPaths, setRegeneratingPaths] = useState<Set<string>>(new Set());

  /** Fichiers sélectionnables de la sélection multi-select (hors ignore-vr). */
  const getSelectedNodes = useCallback((): Node[] => {
    if (selectedPaths.size === 0) return [];
    return allList.filter(n => selectedPaths.has(n.path) && isSelectableTreeFile(n));
  }, [allList, selectedPaths]);

  const getSelectedImagePaths = useCallback((): StoryScreenshotsPath[] => {
    return getSelectedNodes()
      .map(n => n.imagePaths)
      .filter((p): p is StoryScreenshotsPath => Boolean(p));
  }, [getSelectedNodes]);

  // Toujours charger les métriques dès qu’il y a un diff (pas seulement en mode heatmap).
  const countPixelDiff = usePixelDiffMetrics(
    storyScreenshotsPath?.diff,
    leftTab === "regressions" && treeType === "diff" && Boolean(storyScreenshotsPath?.diff),
  );

  const handleCompareStoryFromTree = useCallback(
    async (node: Node) => {
      if (!node.storyId || !node.deviceName || node.ignored) return;
      const path = node.path;
      const lastSlash = path.lastIndexOf("/");
      const componentDir = lastSlash > 0 ? path.slice(0, lastSlash) : undefined;
      setRegeneratingPaths(prev => new Set(prev).add(path));
      try {
        await handleCompareStory(node.storyId, node.deviceName, componentDir);
      } finally {
        setRegeneratingPaths(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [handleCompareStory],
  );

  const handleGenerateFromCatalog = useCallback(() => {
    if (!currentStory || currentStory.ignored) return;
    void handleCompareStoryFromTree(currentStory);
  }, [currentStory, handleCompareStoryFromTree]);

  /** TopBar Valider : sélection batch ou story courante. */
  const handleTopBarValid = useCallback(() => {
    if (multiSelectMode) {
      const items = getSelectedImagePaths();
      if (items.length === 0) return;
      void runBulk(() => handleValidSelected(items));
      return;
    }
    const path = storyScreenshotsPath;
    void handleValid(path);
  }, [multiSelectMode, getSelectedImagePaths, runBulk, handleValidSelected, storyScreenshotsPath, handleValid]);

  /** TopBar Refuser / Supprimer : sélection batch ou story courante. */
  const handleTopBarDelete = useCallback(() => {
    if (multiSelectMode) {
      const items = getSelectedImagePaths();
      if (items.length === 0) return;
      void runBulk(() => handleDeleteSelected(items));
      return;
    }
    const path = storyScreenshotsPath;
    void handleDelete(path);
  }, [multiSelectMode, getSelectedImagePaths, runBulk, handleDeleteSelected, storyScreenshotsPath, handleDelete]);

  /** TopBar Régénérer : compare/selected ou compare single sur currentStory. */
  const handleTopBarRegenerate = useCallback(() => {
    if (multiSelectMode) {
      const nodes = getSelectedNodes().filter(n => n.storyId && n.deviceName);
      if (nodes.length === 0) return;
      const paths = nodes.map(n => n.path);
      const stories = nodes.map(n => {
        const lastSlash = n.path.lastIndexOf("/");
        const componentDir = lastSlash > 0 ? n.path.slice(0, lastSlash) : undefined;
        return {
          storyId: n.storyId as string,
          deviceName: n.deviceName as string,
          componentDir,
        };
      });
      void runBulk(async () => {
        setRegeneratingPaths(prev => {
          const next = new Set(prev);
          paths.forEach(p => next.add(p));
          return next;
        });
        try {
          await handleCompareSelected(stories);
        } finally {
          setRegeneratingPaths(prev => {
            const next = new Set(prev);
            paths.forEach(p => next.delete(p));
            return next;
          });
        }
      });
      return;
    }
    if (!currentStory || currentStory.ignored) return;
    void handleCompareStoryFromTree(currentStory);
  }, [multiSelectMode, getSelectedNodes, runBulk, handleCompareSelected, currentStory, handleCompareStoryFromTree]);

  useEffect(() => {
    if (!showDeleted && !showCompareModal && !showCaptureErrorsModal) return;
    refreshDeleted();
    refreshValidated();
    refreshCaptureErrors();
  }, [showDeleted, showCompareModal, showCaptureErrorsModal, refreshDeleted, refreshValidated, refreshCaptureErrors]);

  const handleCompareAllCaptureErrors = useCallback(
    (deviceName?: string) => {
      const stories = captureErrors
        .filter(item => !deviceName || item.deviceName === deviceName)
        .map(item => ({
          storyId: item.storyId,
          deviceName: item.deviceName,
          componentDir: item.componentDir || undefined,
        }));
      if (stories.length === 0) return;
      void handleCompareSelected(stories);
    },
    [captureErrors, handleCompareSelected],
  );

  const historyTabs = useMemo<TabBarTab<"rejected" | "validated">[]>(
    () => [
      {
        key: "rejected",
        title: "Refusés",
        bullet: { value: deletedList.length, color: "newTheme_danger" },
      },
      {
        key: "validated",
        title: "Validés",
        bullet: { value: validatedList.length, color: "newTheme_primary" },
      },
    ],
    [deletedList.length, validatedList.length],
  );

  const historyList = historyTab === "rejected" ? deletedList : validatedList;
  const historySubtitle =
    historyTab === "rejected"
      ? "Les DIFF refusées seront ignorées à la prochaine génération. Les NEW refusées seront régénérées."
      : "Annuler une validation restaure la baseline précédente (DIFF) ou retire la NEW, et réaffiche la régression.";
  const historyEmptyText = historyTab === "rejected" ? "Aucune screenshot refusée" : "Aucune screenshot validée";
  const onHistoryRestore = historyTab === "rejected" ? handleRestore : handleRevertValidated;

  if (devicesLoading) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        p="m"
      >
        <Typo variant="paragraphe_regular">Chargement de la config devices…</Typo>
      </Box>
    );
  }
  if (devicesError) {
    return (
      <ErrorState
        title="Erreur de configuration des devices"
        message={devicesError}
        hint={`L'interface ne peut pas s'afficher tant que la configuration des devices n'est pas disponible. Vérifie que le serveur VR est démarré (script "vr:server") et que le fichier "vr.config.cjs" existe à la racine de ton projet.`}
      />
    );
  }

  return (
    <DeviceConfigProvider deviceConfigs={devices}>
      <>
        <DraggableSplitView
          left={
            <>
              <Box px="m">
                <TabBar
                  tabs={leftTabs}
                  selectedTabKey={leftTab}
                  onSelectedTabKey={setLeftTab}
                  compressed
                />
              </Box>
              <TreePanel
                tree={activeTree}
                loading={activeLoading}
                onRefresh={refreshActive}
                onNodeClick={goTo}
                currentStory={currentStory}
                onCompareStoryNode={leftTab === "regressions" ? handleCompareStoryFromTree : undefined}
                regeneratingPaths={regeneratingPaths}
                mode={leftTab}
                searchQuery={searchQuery}
                onSearchQuery={setSearchQuery}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                multiSelectMode={multiSelectMode}
                onMultiSelectModeChange={setMultiSelectMode}
                selectedPaths={selectedPaths}
                onTogglePath={handleTogglePath}
                onTogglePaths={handleTogglePaths}
                onSelectPaths={handleSelectPaths}
              />
            </>
          }
          right={
            <Box
              flex={1}
              p="m"
            >
              <VisualRegressionTopBar
                mode={leftTab}
                currentStory={currentStory}
                storyType={storyType}
                treeType={treeType}
                showHeatmap={showHeatmap}
                countPixelDiff={countPixelDiff}
                storyScreenshotsPath={storyScreenshotsPath}
                hasItems={allList.length > 0}
                bulkLoading={bulkLoading}
                multiSelectMode={multiSelectMode}
                selectionCount={selectedPaths.size}
                currentStoryIgnored={Boolean(currentStory?.ignored)}
                onPrev={goPrev}
                onNext={goNext}
                onValid={handleTopBarValid}
                onDelete={handleTopBarDelete}
                onRegenerate={handleTopBarRegenerate}
                onValidAll={() => runBulk(handleValidAll)}
                onDeleteAll={() => runBulk(handleDeleteAll)}
                onShowDeleted={() => setShowDeleted(true)}
                onToggleHeatmap={setShowHeatmap}
                onOpenCompareModal={() => setShowCompareModal(true)}
                onOpenCaptureErrorsModal={() => setShowCaptureErrorsModal(true)}
                captureErrorsCount={captureErrors.length}
              />
              <ContentPanel
                mode={leftTab}
                tree={filteredTree}
                storyType={storyType}
                treeType={treeType}
                showHeatmap={showHeatmap}
                imageUrls={imageUrls}
                isRegenerating={currentStory ? regeneratingPaths.has(currentStory.path) : false}
                storyId={currentStory?.storyId}
                deviceName={currentStory?.deviceName}
                fetchError={leftTab === "regressions" ? treeError : null}
                contentKey={contentKey}
                ignored={Boolean(currentStory?.ignored)}
                onGenerate={leftTab === "all-stories" ? handleGenerateFromCatalog : undefined}
              />
            </Box>
          }
        />
        <Modal
          isOpen={showDeleted}
          onClose={() => {
            setShowDeleted(false);
            setHistoryTab("rejected");
          }}
          header={{
            title: { text: "Historique" },
            subtitle: historySubtitle,
          }}
          content={
            <Box
              flex={1}
              gap="m"
            >
              <TabBar
                tabs={historyTabs}
                selectedTabKey={historyTab}
                onSelectedTabKey={setHistoryTab}
              />
              <FlatList
                data={historyList}
                contentContainerStyle={{ flexGrow: 1, gap: spacing.m, paddingBottom: 50 }}
                keyExtractor={item => `${historyTab}-${item.fullPath}`}
                showsVerticalScrollIndicator
                renderItem={({ item }) => (
                  <DeletedItemRow
                    item={item}
                    onRestore={onHistoryRestore}
                  />
                )}
                ListEmptyComponent={<EndOfList emptyText={historyEmptyText} />}
              />
            </Box>
          }
        />
        <CompareModal
          visible={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          deletedList={deletedList}
          validatedList={validatedList}
          allList={allList}
          storyCount={storyCount}
          onCompareSelected={handleCompareSelected}
          onCompareStory={handleCompareStory}
          onCompareByType={handleCompareByType}
          onCompareAllStories={handleCompareAllStories}
        />
        <CaptureErrorsModal
          visible={showCaptureErrorsModal}
          onClose={() => setShowCaptureErrorsModal(false)}
          errors={captureErrors}
          onCompareSelected={handleCompareSelected}
          onCompareStory={handleCompareStory}
          onCompareAllErrors={handleCompareAllCaptureErrors}
        />
      </>
    </DeviceConfigProvider>
  );
};

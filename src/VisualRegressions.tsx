import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "./atoms/Box";
import { Button } from "./atoms/Button";
import { Divider } from "./atoms/Divider";
import { EndOfList } from "./atoms/EndOfList";
import { Modal } from "./atoms/Modal";
import { TabBar } from "./atoms/TabBar";
import { Typo } from "./atoms/Typo";
import { CompareModal } from "./components/CompareModal";
import { ContentPanel, type ContentPanelMode } from "./components/ContentPanel";
import { DeletedItemRow } from "./components/DeletedItemRow";
import { ErrorState } from "./components/ErrorState";
import { TreePanel, type TreePanelMode } from "./components/TreePanel";
import { VisualRegressionTopBar } from "./components/VisualRegressionTopBar";
import { SCREENSHOTS_DIR, VR_SERVER_URL } from "./constants/constants";
import { DeviceConfigProvider } from "./providers/DeviceConfigProvider";
import { spacing } from "./themes/theme";
import type { DeletedItem, DeviceDisplayConfig, Node, StoryScreenshotsPath } from "./types/types";
import { createVisualRegressionActions } from "./utils";

export type VisualRegressionsProps = {
  /** Config d'affichage des devices (label, icon, color). Optionnel : si absent, récupérée depuis le serveur VR (GET /regressions/config/devices, depuis vr.config.cjs). */
  devices?: DeviceDisplayConfig[];
};

type LeftTab = "regressions" | "all-stories";

const useServerEvents = (onEvent: () => void) => {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`${VR_SERVER_URL}/events`);
      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "index-updated" || data.type === "connected") {
            onEventRef.current();
          }
        } catch {
          /* ignore parse errors */
        }
      };
      eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) setTimeout(() => eventSource?.close(), 2000);
      };
    } catch (err) {
      console.error("❌ Error setting up SSE:", err);
    }
    return () => {
      eventSource?.close();
    };
  }, []);
};

const useRegressionTrees = () => {
  const [data, setData] = useState<{ tree: Node | null; lastUpdate: number }>({ tree: null, lastUpdate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrees = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }
      const response = await fetch(`${VR_SERVER_URL}/regressions/tree`);
      if (!response.ok) throw new Error("Failed to fetch tree");
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("❌ Error fetching tree:", err);
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTrees();
  }, [fetchTrees]);

  const handleServerEvent = useCallback(() => {
    fetchTrees({ silent: true });
  }, [fetchTrees]);

  useServerEvents(handleServerEvent);

  const rebuild = useCallback(async () => {
    try {
      setLoading(true);
      await fetch(`${VR_SERVER_URL}/regressions/rebuild`, { method: "POST" });
    } catch (err) {
      console.error("❌ Error rebuilding index:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { ...data, loading, error, refresh: rebuild, refetch: fetchTrees };
};

const CATALOG_EMPTY_RETRY_MS = 2_500;
const CATALOG_EMPTY_RETRY_MAX = 48; // ~2 min — Storybook peut démarrer après l'UI

/** Catalogue Storybook × devices — fingerprint pour éviter les rebuilds UI inutiles. */
const useAllStoriesTree = (enabled: boolean) => {
  const [data, setData] = useState<{ tree: Node | null; fingerprint: string; storyCount: number }>({
    tree: null,
    fingerprint: "",
    storyCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fingerprintRef = useRef("");
  const storyCountRef = useRef(0);
  const hasTreeRef = useRef(false);

  const fetchCatalog = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }
      const response = await fetch(`${VR_SERVER_URL}/regressions/stories-tree`);
      if (!response.ok) throw new Error("Failed to fetch stories catalog");
      const result = (await response.json()) as {
        tree: Node | null;
        fingerprint: string;
        storyCount: number;
        error?: string;
      };
      if (result.error) throw new Error(result.error);
      const sameFingerprint = result.fingerprint === fingerprintRef.current;
      // Si on a déjà un arbre pour ce fingerprint, ignore. Sinon applique (1er succès / retry).
      if (sameFingerprint && hasTreeRef.current) {
        setError(null);
        return { ok: true as const, storyCount: result.storyCount, empty: result.storyCount === 0 };
      }
      fingerprintRef.current = result.fingerprint;
      hasTreeRef.current = Boolean(result.tree);
      storyCountRef.current = result.storyCount;
      setData({
        tree: result.tree,
        fingerprint: result.fingerprint,
        storyCount: result.storyCount,
      });
      setError(null);
      return { ok: true as const, storyCount: result.storyCount, empty: result.storyCount === 0 };
    } catch (err) {
      console.error("❌ Error fetching stories catalog:", err);
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
      return { ok: false as const, storyCount: storyCountRef.current, empty: true };
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  // Précharge dès le montage : l'UI Expo s'ouvre souvent avant que Storybook soit indexé.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const result = await fetchCatalog({ silent: attempts > 1 });
      if (cancelled) return;
      if (result.ok && !result.empty && hasTreeRef.current) return;
      if (attempts >= CATALOG_EMPTY_RETRY_MAX) {
        if (!hasTreeRef.current) {
          setLoading(false);
          setError(prev => prev ?? "Catalogue Storybook toujours vide après plusieurs tentatives.");
        }
        return;
      }
      schedule(CATALOG_EMPTY_RETRY_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchCatalog]);

  // Rafraîchit à l'ouverture de l'onglet Stories (sans flash si déjà chargé).
  useEffect(() => {
    if (!enabled) return;
    void fetchCatalog({ silent: hasTreeRef.current });
  }, [enabled, fetchCatalog]);

  useServerEvents(
    useCallback(() => {
      void fetchCatalog({ silent: true });
    }, [fetchCatalog]),
  );

  return { ...data, loading, error, refresh: fetchCatalog };
};

const useDeletedRegressions = () => {
  const [deletedList, setDeletedList] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDeleted = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const response = await fetch(`${VR_SERVER_URL}/regressions/deleted`);
      if (!response.ok) throw new Error("Failed to fetch deleted");
      const result = await response.json();
      setDeletedList(result.deleted || []);
    } catch (err) {
      console.error("❌ Error fetching deleted:", err);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useServerEvents(() => {
    fetchDeleted({ silent: true });
  });

  return { deletedList, loading, refresh: fetchDeleted };
};

const usePixelDiffMetrics = (diffPath: string | undefined, enabled: boolean) => {
  const [countPixelDiff, setCountPixelDiff] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !diffPath) {
      setCountPixelDiff(undefined);
      return;
    }

    let cancelled = false;
    setCountPixelDiff(undefined);

    fetch(`${VR_SERVER_URL}/regressions/metrics?path=${encodeURIComponent(diffPath)}`)
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch metrics");
        return res.json();
      })
      .then(result => {
        if (!cancelled) setCountPixelDiff(result.countPixelDiff ?? null);
      })
      .catch(err => {
        console.error("❌ Error fetching pixel diff metrics:", err);
        if (!cancelled) setCountPixelDiff(null);
      });

    return () => {
      cancelled = true;
    };
  }, [diffPath, enabled]);

  return countPixelDiff;
};

const DEVICES_FETCH_TIMEOUT_MS = 10_000;

const useDevicesConfig = (devicesProp?: DeviceDisplayConfig[]) => {
  const hasProp = Boolean(devicesProp && devicesProp.length > 0);
  const [devices, setDevices] = useState<DeviceDisplayConfig[]>(devicesProp ?? []);
  const [loading, setLoading] = useState(!hasProp);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (devicesProp?.length) {
      setDevices(devicesProp);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEVICES_FETCH_TIMEOUT_MS);

    const isCurrent = () => requestId === requestIdRef.current;

    setLoading(true);
    setError(null);

    fetch(`${VR_SERVER_URL}/regressions/config/devices`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) {
          throw new Error(
            `Le serveur VR a répondu avec un statut ${res.status} (${res.statusText || "inconnu"}) pour la config devices.`,
          );
        }
        const data = (await res.json()) as { devices?: DeviceDisplayConfig[] };
        if (!Array.isArray(data?.devices) || data.devices.length === 0) {
          throw new Error("Réponse devices invalide ou vide depuis le serveur VR.");
        }
        if (!isCurrent()) return;
        setDevices(data.devices);
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        if (!isCurrent()) return;
        if (controller.signal.aborted && (err as Error)?.name === "AbortError") {
          setError(`Délai dépassé en contactant le serveur VR (${VR_SERVER_URL}/regressions/config/devices).`);
          setLoading(false);
          return;
        }
        let message: string;
        if (err instanceof TypeError || String(err).includes("Failed to fetch")) {
          message = `Impossible de contacter le serveur VR (${VR_SERVER_URL}). Vérifie qu'il est bien démarré (script "vr:server") et accessible depuis ta machine.`;
        } else if (err instanceof Error) {
          message = err.message;
        } else {
          message = String(err);
        }
        setError(message);
        setLoading(false);
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [devicesProp]);

  return { devices, loading, error };
};

const resolveComponentDir = (node: Node): string | undefined => {
  if (node.componentDir) return node.componentDir;
  const path = node.path;
  const screenshotsIdx = path.lastIndexOf(`/${SCREENSHOTS_DIR}/`);
  if (screenshotsIdx > 0) return path.slice(0, screenshotsIdx);
  const lastSlash = path.lastIndexOf("/");
  return lastSlash > 0 ? path.slice(0, lastSlash) : undefined;
};

export const VisualRegressions = ({ devices: devicesProp }: VisualRegressionsProps) => {
  const [leftTab, setLeftTab] = useState<LeftTab>("regressions");
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedPathRegressions, setSelectedPathRegressions] = useState<string | undefined>();
  const [selectedPathCatalog, setSelectedPathCatalog] = useState<string | undefined>();
  const [pendingRestorePath, setPendingRestorePath] = useState<string | undefined>();
  const [bulkLoading, setBulkLoading] = useState(false);

  const isCatalog = leftTab === "all-stories";
  const selectedPath = isCatalog ? selectedPathCatalog : selectedPathRegressions;
  const setSelectedPath = isCatalog ? setSelectedPathCatalog : setSelectedPathRegressions;

  const { devices, loading: devicesLoading, error: devicesError } = useDevicesConfig(devicesProp);
  const {
    tree: regressionsTree,
    lastUpdate,
    loading: regressionsLoading,
    error: regressionsError,
    refresh: refreshRegressions,
  } = useRegressionTrees();
  const {
    tree: catalogTree,
    fingerprint: catalogFingerprint,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useAllStoriesTree(isCatalog);
  const { deletedList, refresh: refreshDeleted } = useDeletedRegressions();

  const tree = isCatalog ? catalogTree : regressionsTree;
  const loading = isCatalog ? catalogLoading : regressionsLoading;
  const treeError = isCatalog ? catalogError : regressionsError;

  const flattenTree = useCallback((node: Node | null): Node[] => {
    if (!node) return [];
    if (node.type === "file") return [node];
    return Object.values(node.children ?? {}).flatMap(flattenTree);
  }, []);

  const allList = useMemo(() => flattenTree(tree), [tree, flattenTree]);
  const regressionsList = useMemo(() => flattenTree(regressionsTree), [regressionsTree, flattenTree]);

  const currentStory = useMemo(
    () => (selectedPath ? allList.find(n => n.path === selectedPath) : undefined),
    [allList, selectedPath],
  );

  const treeType = useMemo<"new" | "diff">(() => {
    if (currentStory?.storyType === "diff") return "diff";
    return "new";
  }, [currentStory]);

  const panelMode = useMemo<ContentPanelMode>(() => {
    if (!isCatalog) return treeType;
    if (currentStory?.storyType === "baseline") return "baseline";
    if (currentStory?.storyType === "missing") return "missing";
    return "missing";
  }, [isCatalog, currentStory, treeType]);

  const imageUrls = useMemo<StoryScreenshotsPath>(
    () => currentStory?.imageUrls || { original: undefined, temp: undefined, diff: undefined, new: undefined },
    [currentStory],
  );

  const storyScreenshotsPath = useMemo<StoryScreenshotsPath | undefined>(
    () => currentStory?.imagePaths,
    [currentStory],
  );

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

  const advanceAfterDelete = useCallback(() => {
    const deletedPath = selectedPathRegressions;
    const remaining = deletedPath ? regressionsList.filter(n => n.path !== deletedPath) : regressionsList;
    if (remaining.length > 0) {
      setSelectedPathRegressions(remaining[0].path);
    } else {
      setSelectedPathRegressions(undefined);
    }
  }, [regressionsList, selectedPathRegressions]);

  const focusRestoredStory = useCallback((fullPath: string) => {
    setPendingRestorePath(fullPath);
  }, []);

  useEffect(() => {
    if (!pendingRestorePath) return;
    const match = regressionsList.find(n => n.path === pendingRestorePath);
    if (match) {
      setSelectedPathRegressions(match.path);
      setPendingRestorePath(undefined);
    }
  }, [pendingRestorePath, regressionsList]);

  useEffect(() => {
    if (!isCatalog && pendingRestorePath) return;
    if (!selectedPath && allList.length > 0) {
      setSelectedPath(allList[0].path);
      return;
    }
    if (selectedPath && allList.length > 0 && !allList.some(n => n.path === selectedPath)) {
      setSelectedPath(allList[0].path);
    }
  }, [selectedPath, allList, pendingRestorePath, isCatalog, setSelectedPath]);

  const {
    handleValid,
    handleValidAll,
    handleCompareStory,
    handleCompareSelected,
    handleCompareByType,
    handleCompareAllStories,
    handleDelete,
    handleDeleteAll,
    handleRestore,
  } = createVisualRegressionActions({
    onNext: goNext,
    onAfterDelete: advanceAfterDelete,
    onAfterRestore: focusRestoredStory,
    onAfterBulk: () => setSelectedPathRegressions(undefined),
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

  const countPixelDiff = usePixelDiffMetrics(
    storyScreenshotsPath?.diff,
    !isCatalog && showHeatmap && treeType === "diff" && Boolean(storyScreenshotsPath?.diff),
  );

  const handleCompareStoryFromTree = useCallback(
    async (node: Node) => {
      if (!node.storyId || !node.deviceName || node.ignored) return;
      const path = node.path;
      const componentDir = resolveComponentDir(node);
      setRegeneratingPaths(prev => new Set(prev).add(path));
      try {
        await handleCompareStory(node.storyId, node.deviceName, componentDir);
        if (isCatalog) {
          await refreshCatalog({ silent: true });
        }
      } finally {
        setRegeneratingPaths(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [handleCompareStory, isCatalog, refreshCatalog],
  );

  const handleRefresh = useCallback(() => {
    if (isCatalog) {
      void refreshCatalog();
    } else {
      void refreshRegressions();
    }
  }, [isCatalog, refreshCatalog, refreshRegressions]);

  useEffect(() => {
    if (showDeleted) refreshDeleted();
  }, [showDeleted, refreshDeleted]);

  const leftTabs = useMemo(
    () => [
      { key: "regressions" as const, title: "Régressions", alertTextInfo: regressionsList.length },
      { key: "all-stories" as const, title: "Stories", alertTextInfo: catalogTree?.countTotal },
    ],
    [regressionsList.length, catalogTree?.countTotal],
  );

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

  const treeMode: TreePanelMode = isCatalog ? "all-stories" : "regressions";

  return (
    <DeviceConfigProvider deviceConfigs={devices}>
      <>
        <Box
          flex={1}
          flexDirection="row"
          backgroundColor="newTheme_background"
        >
          <Box
            flexDirection="column"
            style={{ alignSelf: "stretch", width: 300 }}
          >
            <Box px="m">
              <Box
                flexDirection="row"
                alignItems="center"
                justifyContent="space-between"
                pb="s"
              >
                <TabBar
                  tabs={leftTabs}
                  selectedTabKey={leftTab}
                  onSelectedTabKey={setLeftTab}
                />
                <Button
                  icon={{ name: "replay" }}
                  color="base"
                  onPress={handleRefresh}
                  loading={loading}
                />
              </Box>
            </Box>
            <TreePanel
              tree={tree}
              onNodeClick={goTo}
              currentStory={currentStory}
              onCompareStoryNode={handleCompareStoryFromTree}
              regeneratingPaths={regeneratingPaths}
              mode={treeMode}
            />
          </Box>
          <Divider orientation="vertical" />
          <Box
            flex={1}
            p="m"
          >
            <VisualRegressionTopBar
              currentStory={currentStory}
              treeType={treeType}
              showHeatmap={showHeatmap}
              countPixelDiff={!isCatalog && showHeatmap ? countPixelDiff : undefined}
              storyScreenshotsPath={storyScreenshotsPath}
              hasItems={allList.length > 0}
              bulkLoading={bulkLoading}
              variant={isCatalog ? "catalog" : "regressions"}
              onPrev={goPrev}
              onNext={goNext}
              onValid={() => handleValid(storyScreenshotsPath)}
              onDelete={() => handleDelete(storyScreenshotsPath)}
              onValidAll={() => runBulk(handleValidAll)}
              onDeleteAll={() => runBulk(handleDeleteAll)}
              onShowDeleted={() => setShowDeleted(true)}
              onToggleHeatmap={setShowHeatmap}
              onOpenCompareModal={() => setShowCompareModal(true)}
            />
            <ContentPanel
              tree={tree}
              treeType={treeType}
              panelMode={panelMode}
              showHeatmap={showHeatmap}
              imageUrls={imageUrls}
              isRegenerating={currentStory ? regeneratingPaths.has(currentStory.path) : false}
              storyId={currentStory?.storyId}
              deviceName={currentStory?.deviceName}
              fetchError={treeError}
              loading={loading}
              contentKey={
                isCatalog ? `${selectedPath ?? ""}-${catalogFingerprint}` : `${selectedPath ?? ""}-${lastUpdate}`
              }
              ignored={Boolean(currentStory?.ignored)}
              onGenerate={
                currentStory && !currentStory.ignored
                  ? () => {
                      void handleCompareStoryFromTree(currentStory);
                    }
                  : undefined
              }
            />
          </Box>
        </Box>
        <Modal
          isOpen={showDeleted}
          onClose={() => setShowDeleted(false)}
          header={{
            title: { text: "Historique des refusés" },
            subtitle:
              "Les régressions visuelles (DIFF) refusées seront ignorées lors de la prochaine génération de VR. Les nouvelles screenshots (NEW) qui ont été refusées seront, quand à elles, regénénées",
          }}
          content={
            <FlatList
              data={deletedList}
              contentContainerStyle={{ flex: 1, gap: spacing.m, paddingBottom: 50 }}
              keyExtractor={item => item.fullPath}
              showsVerticalScrollIndicator
              renderItem={({ item }) => (
                <DeletedItemRow
                  item={item}
                  onRestore={handleRestore}
                />
              )}
              ListEmptyComponent={<EndOfList emptyText="Aucune screenshot refusée" />}
            />
          }
        />
        <CompareModal
          visible={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          deletedList={deletedList}
          allList={regressionsList}
          onCompareSelected={handleCompareSelected}
          onCompareStory={handleCompareStory}
          onCompareByType={handleCompareByType}
          onCompareAllStories={handleCompareAllStories}
        />
      </>
    </DeviceConfigProvider>
  );
};

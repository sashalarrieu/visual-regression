import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "./atoms/Box";
import { Divider } from "./atoms/Divider";
import { EndOfList } from "./atoms/EndOfList";
import { Modal } from "./atoms/Modal";
import { Typo } from "./atoms/Typo";
import { CompareModal } from "./components/CompareModal";
import { ContentPanel } from "./components/ContentPanel";
import { DeletedItemRow } from "./components/DeletedItemRow";
import { ErrorState } from "./components/ErrorState";
import { TreePanel } from "./components/TreePanel";
import { VisualRegressionTopBar } from "./components/VisualRegressionTopBar";
import { VR_SERVER_URL } from "./constants/constants";
import { DeviceConfigProvider } from "./providers/DeviceConfigProvider";
import { spacing } from "./themes/theme";
import type { DeletedItem, DeviceDisplayConfig, Node, StoryScreenshotsPath } from "./types/types";
import { createVisualRegressionActions } from "./utils";

export type VisualRegressionsProps = {
  /** Config d'affichage des devices (label, icon, color). Optionnel : si absent, récupérée depuis le serveur VR (GET /regressions/config/devices, depuis vr.config.cjs). */
  devices?: DeviceDisplayConfig[];
};

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

  return { ...data, loading, error, refresh: rebuild };
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

const useDevicesConfig = (devicesProp?: DeviceDisplayConfig[]) => {
  const hasProp = Boolean(devicesProp && devicesProp.length > 0);
  const [devices, setDevices] = useState<DeviceDisplayConfig[]>(devicesProp ?? []);
  const [loading, setLoading] = useState(!hasProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (devicesProp?.length) {
      setDevices(devicesProp);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${VR_SERVER_URL}/regressions/config/devices`)
      .then(res => {
        if (!res.ok) {
          throw new Error(
            `Le serveur VR a répondu avec un statut ${res.status} (${res.statusText || "inconnu"}) pour la config devices.`,
          );
        }
        return res.json();
      })
      .then(data => {
        if (!cancelled && Array.isArray(data?.devices)) setDevices(data.devices);
      })
      .catch(err => {
        if (!cancelled) {
          let message: string;
          if (err instanceof TypeError || String(err).includes("Failed to fetch")) {
            message = `Impossible de contacter le serveur VR (${VR_SERVER_URL}). Vérifie qu'il est bien démarré (script "vr:server") et accessible depuis ta machine.`;
          } else if (err instanceof Error) {
            message = err.message;
          } else {
            message = String(err);
          }
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [devicesProp]);

  return { devices, loading, error };
};

export const VisualRegressions = ({ devices: devicesProp }: VisualRegressionsProps) => {
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [pendingRestorePath, setPendingRestorePath] = useState<string | undefined>();
  const [bulkLoading, setBulkLoading] = useState(false);
  /** Path à sélectionner après validate/refuse — figé AVANT l’API pour survivre au SSE. */
  const pendingSelectPathRef = useRef<string | null>(null);

  const { devices, loading: devicesLoading, error: devicesError } = useDevicesConfig(devicesProp);
  const { tree, lastUpdate, loading, error: treeError, refresh } = useRegressionTrees();
  const { deletedList, refresh: refreshDeleted } = useDeletedRegressions();

  const flattenTree = useCallback((node: Node | null): Node[] => {
    if (!node) return [];
    if (node.type === "file") return [node];
    return Object.values(node.children ?? {}).flatMap(flattenTree);
  }, []);

  const allList = useMemo(() => flattenTree(tree), [tree, flattenTree]);

  const currentStory = useMemo(
    () => (selectedPath ? allList.find(n => n.path === selectedPath) : undefined),
    [allList, selectedPath],
  );

  const treeType = useMemo<"new" | "diff">(() => {
    if (!currentStory?.storyType) return "new";
    return currentStory.storyType;
  }, [currentStory]);

  const imageUrls = useMemo<StoryScreenshotsPath>(
    () => currentStory?.imageUrls || { original: undefined, temp: undefined, diff: undefined, new: undefined },
    [currentStory],
  );

  const storyScreenshotsPath = useMemo<StoryScreenshotsPath | undefined>(
    () => currentStory?.imagePaths,
    [currentStory],
  );

  const goTo = useCallback((node: Node) => {
    setSelectedPath(node.path);
  }, []);

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
  }, [allList, selectedPath]);

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
  }, [allList, selectedPath]);

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
  }, [allList, selectedPath]);

  /** Après succès API : ré-applique le pending (no-op si déjà appliqué). */
  const advanceAfterDelete = useCallback(() => {
    const nextPath = pendingSelectPathRef.current;
    if (nextPath) {
      setSelectedPath(nextPath);
    }
  }, [allList]);

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
  }, [pendingRestorePath, allList]);

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
  }, [selectedPath, allList, pendingRestorePath]);

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
    onBeforeRemove: prepareAdvanceAfterRemove,
    onAfterDelete: advanceAfterDelete,
    onAfterRestore: focusRestoredStory,
    onAfterBulk: () => {
      pendingSelectPathRef.current = null;
      setSelectedPath(undefined);
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

  // Toujours charger les métriques dès qu’il y a un diff (pas seulement en mode heatmap).
  const countPixelDiff = usePixelDiffMetrics(
    storyScreenshotsPath?.diff,
    treeType === "diff" && Boolean(storyScreenshotsPath?.diff),
  );

  const handleCompareStoryFromTree = useCallback(
    async (node: Node) => {
      if (!node.storyId || !node.deviceName) return;
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

  useEffect(() => {
    if (showDeleted) refreshDeleted();
  }, [showDeleted, refreshDeleted]);

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
        <Box
          flex={1}
          flexDirection="row"
          backgroundColor="newTheme_background"
        >
          <TreePanel
            tree={tree}
            loading={loading}
            onRefresh={refresh}
            onNodeClick={goTo}
            currentStory={currentStory}
            onCompareStoryNode={handleCompareStoryFromTree}
            regeneratingPaths={regeneratingPaths}
          />
          <Divider orientation="vertical" />
          <Box
            flex={1}
            p="m"
          >
            <VisualRegressionTopBar
              currentStory={currentStory}
              treeType={treeType}
              showHeatmap={showHeatmap}
              countPixelDiff={countPixelDiff}
              storyScreenshotsPath={storyScreenshotsPath}
              hasItems={allList.length > 0}
              bulkLoading={bulkLoading}
              onPrev={goPrev}
              onNext={goNext}
              onValid={() => {
                // Snapshot sync avant re-render (onBeforeRemove change la sélection).
                const path = storyScreenshotsPath;
                void handleValid(path);
              }}
              onDelete={() => {
                const path = storyScreenshotsPath;
                void handleDelete(path);
              }}
              onValidAll={() => runBulk(handleValidAll)}
              onDeleteAll={() => runBulk(handleDeleteAll)}
              onShowDeleted={() => setShowDeleted(true)}
              onToggleHeatmap={setShowHeatmap}
              onOpenCompareModal={() => setShowCompareModal(true)}
            />
            <ContentPanel
              tree={tree}
              treeType={treeType}
              showHeatmap={showHeatmap}
              imageUrls={imageUrls}
              isRegenerating={currentStory ? regeneratingPaths.has(currentStory.path) : false}
              storyId={currentStory?.storyId}
              deviceName={currentStory?.deviceName}
              fetchError={treeError}
              contentKey={`${selectedPath ?? ""}-${lastUpdate}`}
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
          allList={allList}
          onCompareSelected={handleCompareSelected}
          onCompareStory={handleCompareStory}
          onCompareByType={handleCompareByType}
          onCompareAllStories={handleCompareAllStories}
        />
      </>
    </DeviceConfigProvider>
  );
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList } from "react-native";

import type { DeletedItem, DeviceDisplayConfig, Node, StoryScreenshotsPath } from "@app-types/types";
import { Box } from "@atoms/Box";
import { Divider } from "@atoms/Divider";
import { EndOfList } from "@atoms/EndOfList";
import { Modal } from "@atoms/Modal";
import { Typo } from "@atoms/Typo";
import { CompareModal } from "@components/CompareModal";
import { ContentPanel } from "@components/ContentPanel";
import { DeletedItemRow } from "@components/DeletedItemRow";
import { TreePanel } from "@components/TreePanel";
import { VisualRegressionTopBar } from "@components/VisualRegressionTopBar";
import { VR_SERVER_URL } from "@constants/constants";
import { DeviceConfigProvider } from "@providers/DeviceConfigProvider";
import { spacing } from "@themes/theme";
import { createVisualRegressionActions } from "@utils";

export type VisualRegressionsProps = {
  /** Config d'affichage des devices (label, icon, color). Optionnel : si absent, récupérée depuis le serveur VR (GET /regressions/config/devices, depuis vr-devices.config.cjs). */
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
          if (data.type === "cache-updated") onEventRef.current();
          else if (data.type === "connected" && data.lastUpdate) onEventRef.current();
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

  const fetchTrees = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${VR_SERVER_URL}/regressions/tree`);
      if (!response.ok) throw new Error("Failed to fetch tree");
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("❌ Error fetching tree:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrees();
  }, [fetchTrees]);

  const handleServerEvent = useCallback(() => {
    fetchTrees();
  }, [fetchTrees]);

  useServerEvents(handleServerEvent);

  return { ...data, loading, error, refresh: fetchTrees };
};

const useDeletedRegressions = () => {
  const [deletedList, setDeletedList] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDeleted = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${VR_SERVER_URL}/regressions/deleted`);
      if (!response.ok) throw new Error("Failed to fetch deleted");
      const result = await response.json();
      setDeletedList(result.deleted || []);
    } catch (err) {
      console.error("❌ Error fetching deleted:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useServerEvents(fetchDeleted);

  return { deletedList, loading, refresh: fetchDeleted };
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
        if (!res.ok) throw new Error("Failed to fetch devices config");
        return res.json();
      })
      .then(data => {
        if (!cancelled && Array.isArray(data?.devices)) setDevices(data.devices);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
  const [currentStory, setCurrentStory] = useState<Node | undefined>();

  const { devices, loading: devicesLoading, error: devicesError } = useDevicesConfig(devicesProp);
  const { tree, loading, refresh } = useRegressionTrees();
  const { deletedList, refresh: refreshDeleted } = useDeletedRegressions();

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

  const flattenTree = useCallback((node: Node | null): Node[] => {
    if (!node) return [];
    if (node.type === "file") return [node];
    return Object.values(node.children ?? {}).flatMap(flattenTree);
  }, []);

  const allList = useMemo(() => flattenTree(tree), [tree, flattenTree]);

  const goTo = useCallback(
    (node: Node) => {
      const index = allList.findIndex(n => n.path === node.path);
      if (index !== -1) setCurrentStory(allList[index]);
    },
    [allList],
  );

  const goNext = useCallback(() => {
    if (!currentStory) {
      if (allList.length) setCurrentStory(allList[0]);
      return;
    }
    const index = allList.findIndex(n => n.path === currentStory.path);
    if (index < allList.length - 1) setCurrentStory(allList[index + 1]);
    else setCurrentStory(allList[0]);
  }, [allList, currentStory]);

  const goPrev = useCallback(() => {
    if (!currentStory) {
      if (allList.length) setCurrentStory(allList[0]);
      return;
    }
    const index = allList.findIndex(n => n.path === currentStory.path);
    if (index > 0) setCurrentStory(allList[index - 1]);
    else setCurrentStory(allList[allList.length - 1]);
  }, [allList, currentStory]);

  const {
    handleValid,
    handleCompareStory,
    handleCompareSelected,
    handleCompareByType,
    handleCompareAllStories,
    handleDelete,
    handleRestore,
  } = createVisualRegressionActions(goNext, refresh, refreshDeleted);

  const [regeneratingPaths, setRegeneratingPaths] = useState<Set<string>>(new Set());
  const [imageCacheKey, setImageCacheKey] = useState(0);

  const handleCompareStoryFromTree = useCallback(
    async (node: Node) => {
      if (!node.storyId || !node.deviceName) return;
      const path = node.path;
      const isCurrentStory = currentStory?.path === path;
      setRegeneratingPaths(prev => new Set(prev).add(path));
      try {
        await handleCompareStory(node.storyId, node.deviceName);
        if (isCurrentStory) setImageCacheKey(prev => prev + 1);
      } finally {
        setRegeneratingPaths(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [handleCompareStory, currentStory?.path],
  );

  const resetCurrentStory = useCallback(() => {
    if (allList.length > 0) setCurrentStory(allList[0]);
  }, [allList]);

  useEffect(() => {
    if (!currentStory) {
      resetCurrentStory();
    } else {
      const index = allList.findIndex(n => n.path === currentStory.path);
      if (index === -1) resetCurrentStory();
    }
  }, [currentStory, allList, resetCurrentStory]);

  useEffect(() => {
    if (showDeleted) refreshDeleted();
  }, [showDeleted, refreshDeleted]);

  const wasRegeneratingRef = useRef(false);
  useEffect(() => {
    if (currentStory) {
      const isRegenerating = regeneratingPaths.has(currentStory.path);
      if (wasRegeneratingRef.current && !isRegenerating) setImageCacheKey(prev => prev + 1);
      wasRegeneratingRef.current = isRegenerating;
    } else {
      wasRegeneratingRef.current = false;
    }
  }, [currentStory, regeneratingPaths]);

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
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        p="m"
      >
        <Typo
          variant="paragraphe_regular"
          color="newTheme_danger"
        >
          Erreur config devices : {devicesError}
        </Typo>
      </Box>
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
              countPixelDiff={showHeatmap && storyScreenshotsPath?.diff ? currentStory?.countPixelDiff : undefined}
              storyScreenshotsPath={storyScreenshotsPath}
              onPrev={goPrev}
              onNext={goNext}
              onValid={() => handleValid(storyScreenshotsPath)}
              onDelete={() => handleDelete(storyScreenshotsPath)}
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
              imageCacheKey={imageCacheKey}
              storyId={currentStory?.storyId}
              deviceName={currentStory?.deviceName}
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

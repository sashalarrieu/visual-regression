import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "./atoms/Box";
import { Bullet } from "./atoms/Bullet";
import { Divider } from "./atoms/Divider";
import { EndOfList } from "./atoms/EndOfList";
import { Modal } from "./atoms/Modal";
import { TabBar, type TabBarTab } from "./atoms/TabBar";
import { Typo } from "./atoms/Typo";
import { CaptureErrorsModal } from "./components/CaptureErrorsModal";
import { CompareModal } from "./components/CompareModal";
import { ContentPanel } from "./components/ContentPanel";
import { DeletedItemRow } from "./components/DeletedItemRow";
import { ErrorState } from "./components/ErrorState";
import { TreePanel } from "./components/TreePanel";
import { VisualRegressionTopBar } from "./components/VisualRegressionTopBar";
import { VR_SERVER_URL } from "./constants/constants";
import { DeviceConfigProvider } from "./providers/DeviceConfigProvider";
import { spacing, type ColorKey } from "./themes/theme";
import type {
  CaptureErrorItem,
  DeletedItem,
  DeviceDisplayConfig,
  Node,
  OrphansTreeResponse,
  StoriesTreeResponse,
  StoryScreenshotsPath,
} from "./types/types";
import {
  createVisualRegressionActions,
  filterTree,
  togglePaths,
  type StatusFilterValue,
  type TreePanelMode,
} from "./utils";

export type VisualRegressionsProps = {
  /** Config d'affichage des devices (label, icon, color). Optionnel : si absent, récupérée depuis le serveur VR (GET /regressions/config/devices, depuis vr.config.cjs). */
  devices?: DeviceDisplayConfig[];
};

/** État UI local, indépendant par onglet (sélection, search, filtres). */
type TabLocalState = {
  selectedPath?: string;
  searchQuery: string;
  statusFilter: Set<StatusFilterValue>;
  multiSelectMode: boolean;
  selectedPaths: Set<string>;
};

const createEmptyTabState = (): TabLocalState => ({
  searchQuery: "",
  statusFilter: new Set(),
  multiSelectMode: false,
  selectedPaths: new Set(),
});

const createInitialTabStates = (): Record<TreePanelMode, TabLocalState> => ({
  regressions: createEmptyTabState(),
  "all-stories": createEmptyTabState(),
  orphans: createEmptyTabState(),
});

type ServerEventListener = () => void;

/** Une seule connexion SSE partagée — évite de saturer le pool HTTP du navigateur (6/host). */
let sharedEventSource: EventSource | null = null;
const serverEventListeners = new Set<ServerEventListener>();

const ensureSharedEventSource = (): void => {
  if (sharedEventSource) return;
  try {
    sharedEventSource = new EventSource(`${VR_SERVER_URL}/events`);
    sharedEventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "index-updated" || data.type === "connected") {
          serverEventListeners.forEach(listener => listener());
        }
      } catch {
        /* ignore parse errors */
      }
    };
    sharedEventSource.onerror = () => {
      if (sharedEventSource?.readyState === EventSource.CLOSED) {
        sharedEventSource = null;
      }
    };
  } catch (err) {
    console.error("❌ Error setting up SSE:", err);
  }
};

const useServerEvents = (onEvent: () => void) => {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    ensureSharedEventSource();
    const listener = () => onEventRef.current();
    serverEventListeners.add(listener);
    return () => {
      serverEventListeners.delete(listener);
      if (serverEventListeners.size === 0 && sharedEventSource) {
        sharedEventSource.close();
        sharedEventSource = null;
      }
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

type FingerprintedFetchOptions = {
  /** Pas de spinner / pas d’erreur UI (SSE, switch d’onglet). */
  silent?: boolean;
};

/** Catalogue / orphelins — fetch avec anti-rebuild via fingerprint (pas de poll). */
const useFingerprintedTree = <T extends { fingerprint: string; tree: Node | null }>(endpoint: string) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);

  const fetchTree = useCallback(
    async (options?: FingerprintedFetchOptions) => {
      try {
        if (!options?.silent) {
          setLoading(true);
          setError(null);
        }
        const response = await fetch(`${VR_SERVER_URL}${endpoint}`);
        if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
        const result = (await response.json()) as T;
        // Anti-rebuild UI : fingerprint structurel identique → no-op (SSE, switch, bouton).
        if (result.fingerprint === fingerprintRef.current) {
          return;
        }
        fingerprintRef.current = result.fingerprint;
        setData(result);
      } catch (err) {
        console.error(`❌ Error fetching ${endpoint}:`, err);
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [endpoint],
  );

  // Chargement initial (badges tabs) — pas de poll ensuite.
  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const handleServerEvent = useCallback(() => {
    fetchTree({ silent: true });
  }, [fetchTree]);

  useServerEvents(handleServerEvent);

  const refresh = useCallback((options?: FingerprintedFetchOptions) => fetchTree(options), [fetchTree]);

  return { data, loading, error, refresh };
};

const useAllStoriesTree = () => {
  const { data, loading, error, refresh } = useFingerprintedTree<StoriesTreeResponse>("/regressions/stories-tree");
  return {
    tree: data?.tree ?? null,
    fingerprint: data?.fingerprint,
    storyCount: data?.storyCount ?? 0,
    loading,
    error,
    refresh,
  };
};

const useOrphansTree = () => {
  const { data, loading, error, refresh } = useFingerprintedTree<OrphansTreeResponse>("/regressions/orphans-tree");
  return {
    tree: data?.tree ?? null,
    fingerprint: data?.fingerprint,
    countTotal: data?.countTotal ?? 0,
    loading,
    error,
    refresh,
  };
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

const useValidatedRegressions = () => {
  const [validatedList, setValidatedList] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchValidated = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const response = await fetch(`${VR_SERVER_URL}/regressions/validated`);
      if (!response.ok) throw new Error("Failed to fetch validated");
      const result = await response.json();
      setValidatedList(result.validated || []);
    } catch (err) {
      console.error("❌ Error fetching validated:", err);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useServerEvents(() => {
    fetchValidated({ silent: true });
  });

  return { validatedList, loading, refresh: fetchValidated };
};

const useCaptureErrors = () => {
  const [errors, setErrors] = useState<CaptureErrorItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchErrors = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const response = await fetch(`${VR_SERVER_URL}/regressions/capture-errors`);
      if (!response.ok) throw new Error("Failed to fetch capture errors");
      const result = await response.json();
      setErrors(Array.isArray(result.errors) ? result.errors : []);
    } catch (err) {
      console.error("❌ Error fetching capture errors:", err);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchErrors();
  }, [fetchErrors]);

  useServerEvents(() => {
    fetchErrors({ silent: true });
  });

  return { errors, loading, refresh: fetchErrors };
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

  const handleTogglePath = useCallback(
    (path: string) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: {
          ...prev[leftTab],
          selectedPaths: togglePaths(prev[leftTab].selectedPaths, [path]),
        },
      }));
    },
    [leftTab],
  );

  const handleTogglePaths = useCallback(
    (paths: readonly string[]) => {
      setTabStates(prev => ({
        ...prev,
        [leftTab]: {
          ...prev[leftTab],
          selectedPaths: togglePaths(prev[leftTab].selectedPaths, paths),
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
    loading: allStoriesLoading,
    refresh: refreshAllStories,
  } = useAllStoriesTree();
  const {
    tree: orphansTree,
    countTotal: orphansCountTotal,
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

  /** Bouton TreePanel : catalogue/orphelins = GET + fingerprint ; régressions = rebuild index. */
  const refreshActive = useCallback(() => {
    if (leftTab === "all-stories") return refreshAllStories();
    if (leftTab === "orphans") return refreshOrphans();
    return refreshRegressions();
  }, [leftTab, refreshAllStories, refreshOrphans, refreshRegressions]);

  /** Compteurs tabs = nœuds fichier avant search/filtre UI. */
  const regressionsCount = regressionsTree?.countTotal ?? 0;
  const catalogCount = allStoriesTree?.countTotal ?? storyCount;

  const leftTabs = useMemo<TabBarTab<TreePanelMode>[]>(() => {
    const tabBullet = (value: number, color: ColorKey) => (
      <Bullet
        value={value}
        color={color}
      />
    );

    const tabs: TabBarTab<TreePanelMode>[] = [
      {
        key: "regressions",
        title: "Régressions",
        badge: tabBullet(regressionsCount, regressionsCount > 0 ? "newTheme_danger" : "newTheme_primary"),
      },
      {
        key: "all-stories",
        title: "Toutes les stories",
        badge: tabBullet(catalogCount, "newTheme_base10"),
      },
    ];

    if (orphansCountTotal > 0) {
      tabs.push({
        key: "orphans",
        title: "Orphelins",
        badge: tabBullet(orphansCountTotal, "newTheme_warning"),
      });
    }

    return tabs;
  }, [regressionsCount, catalogCount, orphansCountTotal]);

  const flattenTree = useCallback((node: Node | null): Node[] => {
    if (!node) return [];
    if (node.type === "file") return [node];
    return Object.values(node.children ?? {}).flatMap(flattenTree);
  }, []);

  const allList = useMemo(() => flattenTree(filteredTree), [filteredTree, flattenTree]);

  /** Élaguer les paths absents de l’arbre filtré (refresh SSE / filtre). */
  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const visible = new Set(allList.map(n => n.path));
    let changed = false;
    const next = new Set<string>();
    for (const path of selectedPaths) {
      if (visible.has(path)) next.add(path);
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

  /** Fichiers de la sélection multi-select (arbre filtré courant). */
  const getSelectedNodes = useCallback((): Node[] => {
    if (selectedPaths.size === 0) return [];
    return allList.filter(n => selectedPaths.has(n.path));
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
    if (!currentStory) return;
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
        badge: (
          <Bullet
            value={deletedList.length}
            color="newTheme_danger"
          />
        ),
      },
      {
        key: "validated",
        title: "Validés",
        badge: (
          <Bullet
            value={validatedList.length}
            color="newTheme_primary"
          />
        ),
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
        <Box
          flex={1}
          flexDirection="row"
          backgroundColor="newTheme_background"
        >
          <Box width={300}>
            <Box px="m">
              <TabBar
                tabs={leftTabs}
                selectedTabKey={leftTab}
                onSelectedTabKey={setLeftTab}
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
            />
          </Box>
          <Divider orientation="vertical" />
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
              contentKey={`${selectedPath ?? ""}-${lastUpdate}`}
              ignored={Boolean(currentStory?.ignored)}
              onGenerate={leftTab === "all-stories" ? handleGenerateFromCatalog : undefined}
            />
          </Box>
        </Box>
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

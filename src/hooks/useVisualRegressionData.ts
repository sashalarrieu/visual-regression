import { useCallback, useEffect, useRef, useState } from "react";

import { VR_SERVER_URL } from "../constants/constants";
import type {
  CaptureErrorItem,
  DeletedItem,
  DeviceDisplayConfig,
  Node,
  OrphansTreeResponse,
  StoriesTreeResponse,
} from "../types/types";
import type { StatusFilterValue, TreePanelMode } from "../utils";

/** État UI local, indépendant par onglet (sélection, search, filtres). */
export type TabLocalState = {
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

export const createInitialTabStates = (): Record<TreePanelMode, TabLocalState> => ({
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

export const useRegressionTrees = () => {
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
  /** Bouton refresh manuel — ignore le fingerprint et met à jour l’UI. */
  force?: boolean;
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
        // Anti-rebuild UI : fingerprint structurel identique → no-op (SSE, switch d’onglet).
        // Le bouton refresh passe force:true pour toujours appliquer la réponse serveur.
        if (!options?.force && result.fingerprint === fingerprintRef.current) {
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

export const useAllStoriesTree = () => {
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

export const useOrphansTree = () => {
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

export const useDeletedRegressions = () => {
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

export const useValidatedRegressions = () => {
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

export const useCaptureErrors = () => {
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

export const usePixelDiffMetrics = (diffPath: string | undefined, enabled: boolean) => {
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

export const useDevicesConfig = (devicesProp?: DeviceDisplayConfig[]) => {
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

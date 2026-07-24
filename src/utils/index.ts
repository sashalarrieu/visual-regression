import {
  FORCE_VR_TAG,
  IGNORE_VR_TAG,
  STORYBOOK_URL,
  UNKNOWN_DEVICE_STYLE,
  VR_SERVER_URL,
} from "../constants/constants";
import type { DeviceDisplayConfig, DeviceStyle, Node, StoryScreenshotsPath, VRDeviceConfig } from "../types/types";

/**
 * Utilitaires partagés (app React + scripts). Code Node-only (import.meta, createRequire) dans ./node.ts.
 */

/** Compte les stories Storybook éligibles à la VR (même filtre que compareAllStories). */
export const fetchStorybookStoryCount = async (serverUrl: string = VR_SERVER_URL): Promise<number> => {
  try {
    const configRes = await fetch(`${serverUrl}/regressions/config`);
    if (configRes.ok) {
      const cfg = (await configRes.json()) as { storyCount?: number; storybookUrl?: string };
      if (typeof cfg.storyCount === "number" && cfg.storyCount > 0) return cfg.storyCount;
      if (cfg.storybookUrl) {
        const res = await fetch(`${cfg.storybookUrl.replace(/\/$/, "")}/index.json`);
        if (res.ok) {
          const data = (await res.json()) as { entries?: Record<string, { type?: string; tags?: string[] }> };
          return Object.entries(data.entries ?? {}).filter(([id, entry]) => {
            if (entry.type !== "story" || id.endsWith("--docs")) return false;
            const tags = entry.tags ?? [];
            return tags.includes(FORCE_VR_TAG) || !tags.includes(IGNORE_VR_TAG);
          }).length;
        }
      }
    }
  } catch {
    // serveur VR ou Storybook indisponible — fallback constante locale
  }
  try {
    const res = await fetch(`${STORYBOOK_URL}/index.json`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { entries?: Record<string, { type?: string; tags?: string[] }> };
    return Object.entries(data.entries ?? {}).filter(([id, entry]) => {
      if (entry.type !== "story" || id.endsWith("--docs")) return false;
      const tags = entry.tags ?? [];
      return tags.includes(FORCE_VR_TAG) || !tags.includes(IGNORE_VR_TAG);
    }).length;
  } catch {
    return 0;
  }
};

export const capitalizeAll = (str: string, locale: string = "fr-FR"): string => {
  if (!str) return str;
  const normalized = str.normalize("NFC");
  const wordRe = /[\p{L}]+(?:[''][\p{L}]+)*/gu;
  return normalized.replace(wordRe, word => {
    const [first, ...rest] = [...word];
    return first.toLocaleUpperCase(locale) + rest.join("").toLocaleLowerCase(locale);
  });
};

/**
 * Construit la liste d'affichage (DeviceDisplayConfig[]) à partir de la config devices du projet hôte.
 * La config (vr.config.cjs) doit impérativement définir pour chaque device : name, viewport, icon, color, label.
 */
export const fromVRDeviceConfig = (devices: VRDeviceConfig[]): DeviceDisplayConfig[] =>
  devices.map(d => ({
    name: d.name,
    label: d.label,
    icon: d.icon,
    color: d.color,
  }));

export type VisualRegressionActionHandlers = {
  /** Figé le path suivant AVANT l’appel API (liste encore complète). */
  onBeforeRemove?: () => void;
  /** Appelé après un refus/validate réussi : applique le path préparé. */
  onAfterDelete: () => void;
  /** Appelé après une restauration depuis l'historique des refusés. */
  onAfterRestore?: (fullPath: string) => void;
  /** Appelé après une action globale (tout valider / tout refuser). */
  onAfterBulk?: () => void;
};

export const createVisualRegressionActions = (
  handlers: VisualRegressionActionHandlers,
  serverUrl: string = VR_SERVER_URL,
) => {
  const { onBeforeRemove, onAfterDelete, onAfterRestore, onAfterBulk } = handlers;

  const handleValid = async (storyScreenshotsPath?: StoryScreenshotsPath) => {
    if (!storyScreenshotsPath) return;
    // Snapshot avant onBeforeRemove (qui change la sélection UI).
    const payload = { ...storyScreenshotsPath };
    onBeforeRemove?.();
    try {
      const res = await fetch(`${serverUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        console.error("❌ Validation échouée :", result.error ?? res.statusText);
        return;
      }
      console.log("✅ Validation réussie");
      onAfterDelete();
    } catch (err) {
      console.error("Erreur de communication avec le serveur VR:", err);
    }
  };

  const handleCompare = async () => {
    try {
      await fetch(`${serverUrl}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("❌ Compare error:", err);
    }
  };

  const handleCompareStory = async (storyId?: string, deviceName?: string, componentDir?: string) => {
    if (!storyId || !deviceName) return;
    try {
      const res = await fetch(`${serverUrl}/compare/single`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, deviceName, componentDir }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Comparaison échouée :", result.error ?? res.statusText);
        return;
      }
      console.log("✅ Comparaison lancée");
    } catch (err) {
      console.error("❌ Compare story error:", err);
    }
  };

  const handleDelete = async (storyScreenshotsPath?: StoryScreenshotsPath) => {
    if (!storyScreenshotsPath) return;
    const payload = { ...storyScreenshotsPath };
    onBeforeRemove?.();
    try {
      const res = await fetch(`${serverUrl}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      console.log("✅ Deleted successfully");
      onAfterDelete();
    } catch (err) {
      console.error("❌ Delete error:", err);
    }
  };

  const handleValidAll = async () => {
    try {
      const res = await fetch(`${serverUrl}/validate/all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Validation globale échouée :", result.error);
        return;
      }
      console.log(`✅ Validation globale : ${result.validated}/${result.total}`);
      onAfterBulk?.();
    } catch (err) {
      console.error("Erreur de communication avec le serveur VR:", err);
    }
  };

  const handleDeleteAll = async () => {
    try {
      const res = await fetch(`${serverUrl}/delete/all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Refus global échoué :", result.error);
        return;
      }
      console.log(`🗃️  Refus global : ${result.deleted}/${result.total}`);
      onAfterBulk?.();
    } catch (err) {
      console.error("❌ Delete all error:", err);
    }
  };

  const handleRestore = async (path: string, isDiff: boolean) => {
    try {
      const res = await fetch(`${serverUrl}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, isDiff }),
      });
      const result = await res.json();
      if (!res.ok) {
        console.error("❌ Restauration échouée :", result.error ?? res.statusText);
        return;
      }
      console.log("✅ Restored successfully");
      onAfterRestore?.(path);
    } catch (err) {
      console.error("❌ Restore error:", err);
    }
  };

  const handleCompareSelected = async (stories: { storyId: string; deviceName: string }[]) => {
    if (!stories.length) return;
    try {
      const res = await fetch(`${serverUrl}/compare/selected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stories }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Régénération échouée :", result.error ?? res.statusText);
        return;
      }
      console.log(`✅ Régénération lancée pour ${stories.length} comparaison(s)`);
    } catch (err) {
      console.error("❌ Compare selected error:", err);
    }
  };

  const handleCompareByType = async (type: "new" | "diff" | "rejected", deviceName?: string) => {
    try {
      const body: { type: "new" | "diff" | "rejected"; deviceName?: string } = { type };
      if (deviceName) body.deviceName = deviceName;
      const res = await fetch(`${serverUrl}/compare/by-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Comparaison par type échouée :", result.error ?? res.statusText);
        return;
      }
    } catch (err) {
      console.error("❌ Compare by type error:", err);
    }
  };

  const handleCompareAllStories = async (deviceName?: string) => {
    try {
      const body: { deviceName?: string } = {};
      if (deviceName) body.deviceName = deviceName;
      const res = await fetch(`${serverUrl}/compare/all-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Régénération globale échouée :", result.error ?? res.statusText);
        return;
      }
    } catch (err) {
      console.error("❌ Compare all stories error:", err);
    }
  };

  return {
    handleValid,
    handleValidAll,
    handleCompare,
    handleCompareStory,
    handleCompareSelected,
    handleCompareByType,
    handleCompareAllStories,
    handleDelete,
    handleDeleteAll,
    handleRestore,
  };
};

/**
 * Retourne le style (icône, couleur) pour l'affichage d'un device.
 * Les devices sont définis par le projet hôte (prop devices) ; aucun défaut côté package.
 */
export const getDeviceStyle = (deviceName?: string, deviceConfigs?: DeviceDisplayConfig[]): DeviceStyle => {
  if (!deviceName || !deviceConfigs?.length) return UNKNOWN_DEVICE_STYLE;
  const c = deviceConfigs.find(d => d.name === deviceName);
  return c ? { icon: c.icon, color: c.color } : UNKNOWN_DEVICE_STYLE;
};

/**
 * Retourne le nom d'affichage d'un device (défini dans la config du projet hôte).
 */
export const getDeviceDisplayName = (deviceName: string, deviceConfigs?: DeviceDisplayConfig[]): string => {
  if (deviceConfigs?.length) {
    const c = deviceConfigs.find(d => d.name === deviceName);
    if (c) return c.label;
  }
  return capitalizeAll(deviceName.replace(/-/g, " "));
};

export const findFirstFile = (node: Node | null): Node | null => {
  if (!node) return null;
  if (node.type === "file") return node;
  const entries = Object.values(node.children ?? {});
  for (const child of entries) {
    const firstFile = findFirstFile(child);
    if (firstFile) return firstFile;
  }
  return null;
};

export const calculateFolderDepth = (path: string): number => {
  const pathParts = path.split("/").filter(part => part.length > 0);
  return Math.max(0, pathParts.length - 1);
};

export const getStoryNameFromId = (storyId: string): string => {
  const lastSeparatorIndex = storyId.lastIndexOf("--");
  if (lastSeparatorIndex !== -1) return storyId.substring(lastSeparatorIndex + 2);
  return storyId;
};

export const formatStoryName = (storyName: string): string => {
  return capitalizeAll(storyName.replace(/-/g, " "));
};

export const formatStoryIdForDisplay = (storyId: string): string => {
  const lastSeparatorIndex = storyId.lastIndexOf("--");
  if (lastSeparatorIndex !== -1) {
    const componentPart = storyId.substring(0, lastSeparatorIndex);
    const storyNamePart = storyId.substring(lastSeparatorIndex + 2);
    const formattedComponent = capitalizeAll(componentPart.replace(/-/g, "/"));
    const formattedStoryName = formatStoryName(storyNamePart);
    return `${formattedComponent} -- ${formattedStoryName}`;
  }
  return formatStoryName(storyId);
};

export const addCacheBusting = (url?: string, cacheKey?: number): string | undefined => {
  if (!url) return undefined;
  if (cacheKey === undefined) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_t=${cacheKey}`;
};

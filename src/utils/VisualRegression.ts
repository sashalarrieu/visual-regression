import type { Node, StoryScreenshotsPath } from "../types";
import { DeviceName } from "../types";
import { capitalizeAll } from "./capitalizeAll";

export const VR_SERVER_URL = "http://localhost:2805";
export { DeviceName } from "../types";

export type DeviceStyle = { icon: string; color: string };

export const createVisualRegressionActions = (
  onNext: () => void,
  onRefresh: () => Promise<void>,
  onRefreshDeleted: () => Promise<void>,
  serverUrl: string = VR_SERVER_URL,
) => {
  const handleValid = async (storyScreenshotsPath?: StoryScreenshotsPath) => {
    if (!storyScreenshotsPath) return;
    try {
      const res = await fetch(`${serverUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storyScreenshotsPath),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        console.error("❌ Validation échouée :", result.error);
        return;
      }
      console.log("✅ Validation réussie");
      onNext();
      await onRefresh();
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

  const handleCompareStory = async (storyId?: string, deviceName?: DeviceName) => {
    if (!storyId || !deviceName) return;
    try {
      const res = await fetch(`${serverUrl}/compare/single`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, deviceName }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) return;
      console.log("✅ Comparaison lancée");
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Compare story error:", err);
    }
  };

  const handleDelete = async (storyScreenshotsPath?: StoryScreenshotsPath) => {
    if (!storyScreenshotsPath) return;
    try {
      const res = await fetch(`${serverUrl}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storyScreenshotsPath),
      });
      if (!res.ok) return;
      console.log("✅ Deleted successfully");
      onNext();
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Delete error:", err);
    }
  };

  const handleRestore = async (path: string, isDiff: boolean) => {
    try {
      const res = await fetch(`${serverUrl}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, isDiff }),
      });
      if (!res.ok) return;
      console.log("✅ Restored successfully");
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Restore error:", err);
    }
  };

  const handleCompareSelected = async (stories: { storyId: string; deviceName: DeviceName }[]) => {
    if (!stories.length) return;
    try {
      const res = await fetch(`${serverUrl}/compare/selected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stories }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) return;
      console.log(`✅ Régénération lancée pour ${stories.length} comparaison(s)`);
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Compare selected error:", err);
    }
  };

  const handleCompareByType = async (type: "new" | "diff" | "rejected", deviceName?: DeviceName) => {
    try {
      const body: { type: "new" | "diff" | "rejected"; deviceName?: DeviceName } = { type };
      if (deviceName) body.deviceName = deviceName;
      const res = await fetch(`${serverUrl}/compare/by-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok || !result.success) return;
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Compare by type error:", err);
    }
  };

  const handleCompareAllStories = async (deviceName?: DeviceName) => {
    try {
      const body: { deviceName?: DeviceName } = {};
      if (deviceName) body.deviceName = deviceName;
      const res = await fetch(`${serverUrl}/compare/all-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok || !result.success) return;
      await onRefresh();
      await onRefreshDeleted();
    } catch (err) {
      console.error("❌ Compare all stories error:", err);
    }
  };

  return {
    handleValid,
    handleCompare,
    handleCompareStory,
    handleCompareSelected,
    handleCompareByType,
    handleCompareAllStories,
    handleDelete,
    handleRestore,
  };
};

export const getDeviceStyle = (deviceName?: DeviceName): DeviceStyle => {
  if (deviceName === DeviceName.iPhone16) return { icon: "mobile", color: "newTheme_fantasy" };
  if (deviceName === DeviceName.IPadA16Portrait) return { icon: "tablet-portrait", color: "newTheme_warning" };
  if (deviceName === DeviceName.IPadA16Landscape) return { icon: "tablet-landscape", color: "newTheme_info" };
  if (deviceName === DeviceName.DesktopFHD) return { icon: "laptop", color: "newTheme_primary" };
  return { icon: "hint", color: "newTheme_danger" };
};

export const getDeviceDisplayName = (deviceName: DeviceName): string => {
  if (deviceName === DeviceName.iPhone16) return "iPhone 16";
  if (deviceName === DeviceName.IPadA16Portrait) return "iPad A16 Portrait";
  if (deviceName === DeviceName.IPadA16Landscape) return "iPad A16 Paysage";
  if (deviceName === DeviceName.DesktopFHD) return "Desktop FHD";
  return deviceName;
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

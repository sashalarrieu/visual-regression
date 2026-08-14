import { FORCE_VR_TAG, IGNORE_VR_TAG } from "../constants/constants";

/** Story taguée `ignore-vr` sans override `force-vr`. */
export const isIgnoredVrStory = (tags: string[] | undefined): boolean => {
  const list = tags ?? [];
  return list.includes(IGNORE_VR_TAG) && !list.includes(FORCE_VR_TAG);
};

export type StorybookEntryLike = {
  id?: string;
  type?: string;
  tags?: string[];
};

/** Filtre d'éligibilité VR (index Storybook, compare, UI). */
export const shouldIncludeStoryForVisualRegression = (entry: StorybookEntryLike): boolean => {
  if (entry.type !== "story") return false;
  if (entry.id?.endsWith("--docs")) return false;
  return !isIgnoredVrStory(entry.tags);
};

/** Log de repli quand une capture ignore-vr arrive quand même au moteur. */
export const formatIgnoreVrFallbackLog = (storyId: string, deviceName: string): string =>
  `🏳️ [ignore-vr fallback] Capture bloquée : ${deviceName}/${storyId} (tag ignore-vr)`;

/** StoryIds taguées ignore-vr (sans force-vr) — à exclure des erreurs de capture. */
export const collectIgnoredVrStoryIds = (entries: Record<string, { id?: string; tags?: string[] }>): Set<string> => {
  const ids = new Set<string>();
  for (const entry of Object.values(entries)) {
    if (entry.id && isIgnoredVrStory(entry.tags)) ids.add(entry.id);
  }
  return ids;
};

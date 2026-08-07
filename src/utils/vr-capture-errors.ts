/**
 * Persistance des erreurs de capture (story × device) dans `.vr-cache/capture-errors.json`.
 * Mis à jour après chaque batch : succès → retrait ; échec → upsert.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { CaptureErrorItem } from "../types/types";

export type { CaptureErrorItem };

export type CaptureErrorsFile = {
  items: CaptureErrorItem[];
};

export const captureErrorKey = (storyId: string, deviceName: string): string => `${deviceName}::${storyId}`;

export const getCaptureErrorsPath = (projectRoot: string): string =>
  path.join(projectRoot, ".vr-cache", "capture-errors.json");

export const readCaptureErrors = (projectRoot: string): CaptureErrorItem[] => {
  try {
    const filePath = getCaptureErrorsPath(projectRoot);
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CaptureErrorsFile | CaptureErrorItem[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item): item is CaptureErrorItem =>
        Boolean(item) &&
        typeof item.storyId === "string" &&
        typeof item.deviceName === "string" &&
        typeof item.message === "string",
    );
  } catch {
    return [];
  }
};

export const writeCaptureErrors = (projectRoot: string, items: CaptureErrorItem[]): void => {
  try {
    const filePath = getCaptureErrorsPath(projectRoot);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: CaptureErrorsFile = { items };
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    // best-effort — ne pas faire échouer la capture
  }
};

const sortCaptureErrors = (items: CaptureErrorItem[]): CaptureErrorItem[] =>
  [...items].sort((a, b) => {
    const byStory = a.storyId.localeCompare(b.storyId);
    if (byStory !== 0) return byStory;
    return a.deviceName.localeCompare(b.deviceName);
  });

/**
 * Met à jour le store pour les tâches résolues uniquement (les autres restent inchangées).
 * - `succeeded` : retirées de la liste
 * - `failed` : upsert (message / timestamp / componentDir)
 */
export const syncCaptureErrorsAfterBatch = (
  projectRoot: string,
  update: {
    succeeded: { storyId: string; deviceName: string }[];
    failed: CaptureErrorItem[];
  },
): CaptureErrorItem[] => {
  const byKey = new Map(
    readCaptureErrors(projectRoot).map(item => [captureErrorKey(item.storyId, item.deviceName), item]),
  );

  for (const item of update.succeeded) {
    byKey.delete(captureErrorKey(item.storyId, item.deviceName));
  }

  for (const item of update.failed) {
    byKey.set(captureErrorKey(item.storyId, item.deviceName), {
      storyId: item.storyId,
      deviceName: item.deviceName,
      componentDir: item.componentDir || "",
      message: item.message || "Capture failed",
      at: item.at || Date.now(),
    });
  }

  const next = sortCaptureErrors(Array.from(byKey.values()));
  writeCaptureErrors(projectRoot, next);
  return next;
};

/** Applique le résultat d’un batch (tâches tentées + erreurs structurées). */
export const syncCaptureErrorsFromBatch = (
  projectRoot: string,
  attempted: { storyId: string; deviceName: string; componentDir: string }[],
  failed: CaptureErrorItem[],
): CaptureErrorItem[] => {
  const failedKeys = new Set(failed.map(item => captureErrorKey(item.storyId, item.deviceName)));
  const succeeded = attempted.filter(task => !failedKeys.has(captureErrorKey(task.storyId, task.deviceName)));
  return syncCaptureErrorsAfterBatch(projectRoot, { succeeded, failed });
};

/** Marque toutes les tâches tentées en erreur (daemon down, échec global). */
export const syncCaptureErrorsAllFailed = (
  projectRoot: string,
  attempted: { storyId: string; deviceName: string; componentDir: string }[],
  message: string,
): CaptureErrorItem[] => {
  const at = Date.now();
  const failed: CaptureErrorItem[] = attempted.map(task => ({
    storyId: task.storyId,
    deviceName: task.deviceName,
    componentDir: task.componentDir,
    message,
    at,
  }));
  return syncCaptureErrorsFromBatch(projectRoot, attempted, failed);
};

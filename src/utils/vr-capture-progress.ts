/**
 * Progression de capture partagée hôte ↔ sidecar via le volume projet monté.
 * Le daemon écrit ; l'hôte lit pendant l'attente HTTP du lot (sinon console muette).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type CaptureProgressSnapshot = {
  done: number;
  total: number;
  storyId?: string;
  deviceName?: string;
  chunk?: number;
  chunks?: number;
  updatedAt: number;
};

export const getCaptureProgressPath = (projectRoot: string): string =>
  path.join(projectRoot, ".vr-cache", "capture-progress.json");

export const writeCaptureProgress = (projectRoot: string, snapshot: CaptureProgressSnapshot): void => {
  try {
    const filePath = getCaptureProgressPath(projectRoot);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
  } catch {
    // best-effort — ne pas faire échouer la capture
  }
};

export const readCaptureProgress = (projectRoot: string): CaptureProgressSnapshot | null => {
  try {
    const filePath = getCaptureProgressPath(projectRoot);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CaptureProgressSnapshot;
    if (typeof parsed.done !== "number" || typeof parsed.total !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
};

export const formatCaptureProgressLine = (snapshot: CaptureProgressSnapshot): string => {
  const label = snapshot.storyId ? `${snapshot.deviceName ? `${snapshot.deviceName}/` : ""}${snapshot.storyId}` : "…";
  const chunk = snapshot.chunk && snapshot.chunks ? ` · lot ${snapshot.chunk}/${snapshot.chunks}` : "";
  return `📸 ${snapshot.done}/${snapshot.total}${chunk} — ${label}`;
};

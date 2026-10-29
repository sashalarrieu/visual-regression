/**
 * Comparaison pixelmatch des screenshots VR (baseline vs temp).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import type { LogsType } from "../types/types";

import { getProjectRoot } from "./node";

const PROJECT_ROOT = getProjectRoot();

export type CompareScreenshotOutcome = "match" | "new" | "diff" | "missing_temp";

export type CompareScreenshotResult = {
  outcome: CompareScreenshotOutcome;
  diffPixels: number;
};

const buffersEqual = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) return false;
  return a.equals(b);
};

const addLogs = ({ log, type = "error", logs }: { log: string; type?: "error" | "vr" | "new"; logs: LogsType }) => {
  if (type === "new") {
    console.log(log);
    logs.news.push(log);
    return;
  }
  if (type === "vr") {
    console.warn(log);
    logs.vrs.push(log);
    return;
  }
  console.error(log);
  logs.errors.push(log);
};

export const compareScreenshots = ({
  storyId,
  screenshotPath,
  publicScreenshotPath,
  newScreenshotPath,
  tempScreenshotPath,
  diffScreenshotPath,
  storiesWithDiff,
  logs,
  threshold,
}: {
  storyId: string;
  screenshotPath: string;
  publicScreenshotPath: string;
  newScreenshotPath: string;
  tempScreenshotPath: string;
  diffScreenshotPath: string;
  storiesWithDiff: string[];
  logs: LogsType;
  threshold: number;
}): CompareScreenshotResult => {
  if (!existsSync(tempScreenshotPath)) {
    addLogs({ log: `🚫 No temp screenshot found for ${tempScreenshotPath}`, logs });
    return { outcome: "missing_temp", diffPixels: 0 };
  }

  if (!existsSync(screenshotPath)) {
    renameSync(tempScreenshotPath, newScreenshotPath);
    const displayPath = path.isAbsolute(screenshotPath)
      ? path.relative(PROJECT_ROOT, screenshotPath).replace(/\\/g, "/")
      : screenshotPath;
    addLogs({ log: `❇️  New screenshot for ${displayPath}`, type: "new", logs });
    return { outcome: "new", diffPixels: 0 };
  }

  const baselineBuffer = readFileSync(screenshotPath);
  const tempBuffer = readFileSync(tempScreenshotPath);

  if (buffersEqual(baselineBuffer, tempBuffer)) {
    try {
      unlinkSync(tempScreenshotPath);
    } catch {
      // ignore
    }
    console.log(`✅ No visual regression for ${storyId}`);
    return { outcome: "match", diffPixels: 0 };
  }

  const img1 = PNG.sync.read(baselineBuffer);
  const img2 = PNG.sync.read(tempBuffer);

  if (img1.width !== img2.width || img1.height !== img2.height) {
    mkdirSync(path.dirname(diffScreenshotPath), { recursive: true });
    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);
    const diff = new PNG({ width, height });
    const tmp1 = new PNG({ width, height });
    PNG.bitblt(img1, tmp1, 0, 0, img1.width, img1.height, 0, 0);
    const tmp2 = new PNG({ width, height });
    PNG.bitblt(img2, tmp2, 0, 0, img2.width, img2.height, 0, 0);
    pixelmatch(tmp1.data, tmp2.data, diff.data, width, height, { threshold });
    writeFileSync(diffScreenshotPath, PNG.sync.write(diff));
    copyFileSync(screenshotPath, publicScreenshotPath);
    if (!storiesWithDiff.includes(diffScreenshotPath)) {
      storiesWithDiff.push(diffScreenshotPath);
    }
    addLogs({ log: `⚠️  Visual regression for ${storyId} (size mismatch)`, type: "vr", logs });
    return { outcome: "diff", diffPixels: Number.MAX_SAFE_INTEGER };
  }

  const diff = new PNG({ width: img1.width, height: img1.height });
  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold });

  if (numDiffPixels > 0) {
    mkdirSync(path.dirname(diffScreenshotPath), { recursive: true });
    writeFileSync(diffScreenshotPath, PNG.sync.write(diff));
    copyFileSync(screenshotPath, publicScreenshotPath);
    if (!storiesWithDiff.includes(diffScreenshotPath)) {
      storiesWithDiff.push(diffScreenshotPath);
    }
    addLogs({ log: `⚠️  Visual regression for ${storyId} (${numDiffPixels} pixels)`, type: "vr", logs });
    return { outcome: "diff", diffPixels: numDiffPixels };
  }

  try {
    unlinkSync(tempScreenshotPath);
  } catch {
    // ignore
  }
  console.log(`✅ No visual regression for ${storyId}`);
  return { outcome: "match", diffPixels: 0 };
};

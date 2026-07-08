/**
 * SteadySnap local — stabilisation anti-flake des captures VR.
 * Couches : attente composite, freeze contenu dynamique, burst sélectif, vérification diff.
 */
import { writeFileSync } from "fs";

import pixelmatch from "pixelmatch";
import type { Locator, Page } from "playwright";
import { PNG } from "pngjs";

import type { VrConfig } from "@app-types/types";
import { PLAY_FN_TAG, SKIP_PLAY_VR_TAG } from "@constants/constants";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const remainingMs = (deadline: number): number => Math.max(0, deadline - Date.now());

const buffersEqual = (a: Buffer, b: Buffer): boolean => a.length === b.length && a.equals(b);

const countDiffPixels = (buf1: Buffer, buf2: Buffer, threshold: number): number => {
  const img1 = PNG.sync.read(buf1);
  const img2 = PNG.sync.read(buf2);
  if (img1.width !== img2.width || img1.height !== img2.height) return Number.MAX_SAFE_INTEGER;
  const diff = new PNG({ width: img1.width, height: img1.height });
  return pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold });
};

const pickConsensusFrameIndex = (frames: Buffer[], threshold: number): number => {
  if (frames.length === 0) return 0;
  if (frames.length === 1) return 0;

  for (let i = 1; i < frames.length; i++) {
    if (buffersEqual(frames[i], frames[i - 1])) return i;
  }

  let bestIdx = 0;
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < frames.length; i++) {
    let sum = 0;
    for (let j = 0; j < frames.length; j++) {
      if (i === j) continue;
      sum += countDiffPixels(frames[i], frames[j], threshold);
    }
    const avg = sum / (frames.length - 1);
    if (avg < bestScore) {
      bestScore = avg;
      bestIdx = i;
    }
  }
  return bestIdx;
};

/** Suit les requêtes réseau actives pour détecter une fenêtre « quiet ». */
export class NetworkQuietTracker {
  private pending = 0;
  private attached = false;

  attach(page: Page): void {
    if (this.attached) return;
    this.attached = true;

    const dec = (): void => {
      this.pending = Math.max(0, this.pending - 1);
    };

    page.on("request", req => {
      if (req.resourceType() === "websocket") return;
      this.pending++;
    });
    page.on("requestfinished", dec);
    page.on("requestfailed", dec);
  }

  async waitQuiet(quietMs: number, maxWaitMs: number): Promise<void> {
    if (quietMs <= 0 || maxWaitMs <= 0) return;

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (this.pending === 0) {
        await sleep(quietMs);
        if (this.pending === 0) return;
      }
      await sleep(50);
    }
  }
}

export const expectsVrStoryPlay = (storyTags: string[]): boolean =>
  storyTags.includes(PLAY_FN_TAG) && !storyTags.includes(SKIP_PLAY_VR_TAG);

/** Ajoute `vr-capture=1` pour activer le mode capture côté Storybook preview. */
export const appendVrCaptureParam = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("vr-capture", "1");
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}vr-capture=1`;
  }
};

/** Pause vidéos/audio et fige les éléments dynamiques avant screenshot. */
export const freezeDynamicContent = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach(video => {
      try {
        video.pause();
        video.currentTime = 0;
      } catch {
        // ignore
      }
    });
    document.querySelectorAll("audio").forEach(audio => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    });
  });
};

/**
 * Attente composite SteadySnap : root, fonts, images, data-vr-ready, freeze CSS, network quiet.
 */
export const waitForStoryStable = async (
  page: Page,
  config: VrConfig,
  tracker?: NetworkQuietTracker,
  storyTags: string[] = [],
): Promise<void> => {
  const captureTimeout = config.capture.maxTestTime;
  const maxStabilize = config.stabilize.maxStabilizeTime;
  const budget = maxStabilize > 0 ? Math.min(maxStabilize, captureTimeout) : captureTimeout;
  const deadline = Date.now() + budget;
  const stepTimeout = (): number => Math.max(500, remainingMs(deadline));
  const expectsPlay = expectsVrStoryPlay(storyTags);

  await page.waitForSelector("#storybook-root >> visible=true", { timeout: stepTimeout() });

  if (config.stabilize.waitFonts) {
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });
  }

  await page.waitForFunction(() => (document.querySelector("#storybook-root")?.children.length ?? 0) > 0, {
    timeout: stepTimeout(),
  });

  await page.waitForFunction(
    expectsPlay => {
      const root = document.querySelector("#storybook-root");
      if (!root) return false;
      if (expectsPlay) return root.getAttribute("data-vr-ready") === "true";
      if (!root.hasAttribute("data-vr-ready")) return true;
      return root.getAttribute("data-vr-ready") === "true";
    },
    expectsPlay,
    { timeout: stepTimeout() },
  );

  await page.waitForFunction(
    () => {
      const root = document.querySelector("#storybook-root");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every(img => img.complete);
    },
    { timeout: stepTimeout() },
  );

  if (config.stabilize.freezeAnimations) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });
    await freezeDynamicContent(page);
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }

  const quietMs = config.stabilize.waitNetworkQuietMs;
  if (quietMs > 0 && tracker) {
    await tracker.waitQuiet(quietMs, remainingMs(deadline));
  }
};

/** Capture burst : N frames → sélection consensus (paire identique ou frame la plus stable). */
export const captureWithBurst = async (
  page: Page,
  locator: Locator,
  config: VrConfig,
  outputPath: string,
): Promise<void> => {
  const frameCount = Math.max(2, config.stabilize.burstFrames);
  const interval = Math.max(0, config.stabilize.burstIntervalMs);
  const threshold = config.compare.threshold;
  const frames: Buffer[] = [];

  for (let i = 0; i < frameCount; i++) {
    frames.push(await locator.screenshot());
    if (i < frameCount - 1 && interval > 0) {
      await sleep(interval);
    }
  }

  const selected = pickConsensusFrameIndex(frames, threshold);
  writeFileSync(outputPath, frames[selected]);
};

let storyTagsCache: Map<string, string[]> | null = null;
let storyTagsCacheUrl: string | null = null;

/** Tags Storybook d'une story (cache index.json). */
export const getStoryTags = async (storyId: string, storybookUrl: string): Promise<string[]> => {
  const baseUrl = storybookUrl.replace(/\/$/, "");
  if (storyTagsCacheUrl !== baseUrl) {
    storyTagsCache = null;
    storyTagsCacheUrl = baseUrl;
  }

  if (!storyTagsCache) {
    storyTagsCache = new Map();
    try {
      const res = await fetch(`${baseUrl}/index.json`);
      if (res.ok) {
        const data = (await res.json()) as { entries?: Record<string, { tags?: string[] }> };
        for (const [id, entry] of Object.entries(data.entries ?? {})) {
          storyTagsCache.set(id, entry.tags ?? []);
        }
      }
    } catch {
      // Storybook indisponible — pas de tags
    }
  }

  return storyTagsCache.get(storyId) ?? [];
};

export const resetStoryTagsCache = (): void => {
  storyTagsCache = null;
  storyTagsCacheUrl = null;
};

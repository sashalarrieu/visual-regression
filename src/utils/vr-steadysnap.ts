/**
 * SteadySnap local — stabilisation anti-flake des captures VR.
 * Couches : attente composite, freeze contenu dynamique, burst sélectif, vérification diff.
 */
import { writeFileSync } from "fs";

import pixelmatch from "pixelmatch";
import type { Page } from "playwright";
import { PNG } from "pngjs";

import {
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
  VR_CAPTURE_ANIMATION_FREEZE_CSS,
} from "../constants/constants";
import type { VrConfig } from "../types/types";

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

/** Freeze CSS + Reanimated (prefers-reduced-motion) sauf opt-out `live-animation-vr`. */
export const shouldFreezeMotion = (config: VrConfig, storyTags: string[] = []): boolean =>
  config.stabilize.freezeAnimations && !storyTags.includes(LIVE_ANIMATION_VR_TAG);

/**
 * Fige Reanimated web **avant** le chargement de la story : Reanimated lit
 * `prefers-reduced-motion` au import (`ReducedMotionManager`), pas au screenshot.
 * Sans ça, withRepeat/withTiming continuent de tourner (CSS freeze inopérant).
 */
export const applyCaptureMotionPreference = async (page: Page, freeze: boolean): Promise<void> => {
  await page.emulateMedia({ reducedMotion: freeze ? "reduce" : "no-preference" });
};

/**
 * Query params du iframe de capture.
 * - `vr-capture=1` : active les decorators preview (freeze CSS, runner `play()`).
 * - `embed=true` : Storybook désactive l'autoplay (`shouldAutoplay`). Sinon `play()`
 *   tourne juste après le commit React, **avant** les `useEffect` des demos qui
 *   resynchronisent props → state — le clic est alors écrasé (onglet selected, etc.).
 *   Le runner VR rejoue `play()` dans un `useEffect` (après cette sync).
 */
export const appendVrCaptureParam = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("vr-capture", "1");
    parsed.searchParams.set("embed", "true");
    return parsed.toString();
  } catch {
    let next = url;
    if (!next.includes("vr-capture=")) {
      next += `${next.includes("?") ? "&" : "?"}vr-capture=1`;
    }
    if (!/[?&]embed=/.test(next)) {
      next += `${next.includes("?") ? "&" : "?"}embed=true`;
    }
    return next;
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
      const state = root.getAttribute("data-vr-ready");
      // Échec du play() → on interrompt tout de suite (pas de screenshot d'un état faux).
      if (state === "error") {
        const detail = root.getAttribute("data-vr-error");
        throw new Error(detail ? `VR play() a échoué: ${detail}` : "VR play() a échoué (data-vr-ready=error)");
      }
      if (expectsPlay) return state === "true";
      if (state === null) return true;
      return state === "true";
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

  // Si un Modal RNW est déjà porté hors root, attendre une bbox non nulle puis
  // forcer opacity avant freeze CSS (fade figé à 0 sinon).
  const hasPortalDialog = await page.evaluate(`(() => {
    const root = document.querySelector("#storybook-root");
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(
      (el) => !root || !root.contains(el)
    );
  })()`);
  if (hasPortalDialog) {
    try {
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(el => {
            const r = el.getBoundingClientRect();
            return r.width >= 1 && r.height >= 1;
          }),
        { timeout: Math.min(1500, stepTimeout()) },
      );
    } catch {
      // continue — prepare + capture tenteront quand même
    }
    await preparePortalOverlaysForCapture(page);
  }

  if (config.stabilize.freezeAnimations) {
    await page.addStyleTag({ content: VR_CAPTURE_ANIMATION_FREEZE_CSS });
    await freezeDynamicContent(page);
    try {
      await page.evaluate(`(() => {
        const animations = typeof document.getAnimations === "function" ? document.getAnimations() : [];
        return Promise.allSettled(
          animations.map((animation) => {
            try {
              const iterations =
                animation.effect && animation.effect.getComputedTiming
                  ? animation.effect.getComputedTiming().iterations
                  : undefined;
              if (iterations === Infinity) {
                animation.cancel();
                return Promise.resolve();
              }
              if (typeof animation.finish === "function") animation.finish();
              return animation.finished ? animation.finished.catch(() => undefined) : Promise.resolve();
            } catch {
              return Promise.resolve();
            }
          }),
        );
      })()`);
    } catch {
      // best-effort — une animation bloquée ne doit pas faire échouer la capture
    }
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }

  const quietMs = config.stabilize.waitNetworkQuietMs;
  if (quietMs > 0 && tracker) {
    await tracker.waitQuiet(quietMs, remainingMs(deadline));
  }
};

export type CaptureClip = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const unionCaptureClips = (a: CaptureClip, b: CaptureClip): CaptureClip => {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Clip Playwright : entier, dans le viewport (sinon `page.screenshot({ clip })` échoue). */
export const clampCaptureClipToViewport = (
  clip: CaptureClip,
  viewport: { width: number; height: number },
): CaptureClip => {
  const x = Math.max(0, clip.x);
  const y = Math.max(0, clip.y);
  const right = Math.min(viewport.width, clip.x + clip.width);
  const bottom = Math.min(viewport.height, clip.y + clip.height);
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.max(1, Math.ceil(right - x)),
    height: Math.max(1, Math.ceil(bottom - y)),
  };
};

/**
 * RNW Modal (`animationType=fade`) + freeze / ReduceMotion : le dialog est dans le DOM
 * mais les couches (backdrop Reanimated, wrapper CSS fade) restent à opacity 0 →
 * clip élargi = grand blanc + trigger visible à travers.
 * Force opacity sur tout l'arbre portal + coupe les animations CSS.
 */
export const preparePortalOverlaysForCapture = async (page: Page): Promise<void> => {
  // Soften only: kill CSS animation/transition on dialog shells.
  // Do NOT force opacity:1 on every descendant — that turns RNW black backdrops
  // (rgb(0,0,0) at animated opacity 0) into a full-viewport black screenshot.
  await page.evaluate(`(() => {
    const root = document.querySelector("#storybook-root");
    const softForce = (node) => {
      node.style.setProperty("animation", "none", "important");
      node.style.setProperty("transition", "none", "important");
    };
    for (const el of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
      if (root && root.contains(el)) continue;
      let node = el;
      while (node && node !== document.body) {
        if (!root || !root.contains(node)) softForce(node);
        node = node.parentElement;
      }
      softForce(el);
      const style = getComputedStyle(el);
      // Only the dialog shell if still fully transparent (Reanimated mid-open)
      if (Number(style.opacity) === 0) {
        el.style.setProperty("opacity", "1", "important");
        el.style.setProperty("visibility", "visible", "important");
      }
    }
  })()`);
};

/**
 * Calcule le clip de capture élargi si des overlays portailés (modals, dialogs)
 * sont hors de `#storybook-root`. Sinon `null` → screenshot élément root (crop serré).
 *
 * Cas typique : backdrop `position:fixed` recouvre le root (visible dans le crop),
 * mais le panneau modal est centré viewport hors de la bbox du root.
 */
export const resolveExpandedCaptureClip = async (page: Page): Promise<CaptureClip | null> => {
  // String evaluate: tsx/esbuild keepNames injects `__name(...)` into function
  // bodies serialized by Playwright, which throws ReferenceError in the browser.
  const raw = (await page.evaluate(`(() => {
    const root = document.querySelector("#storybook-root");
    if (!root) return { clip: null, viewport: null, diag: { noRoot: true } };

    const overlayBoxes = [];
    const skipTag = { SCRIPT: 1, STYLE: 1, LINK: 1, NOSCRIPT: 1, META: 1, TEMPLATE: 1 };
    const dialogEls = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    const diagSamples = [];

    const visible = (r) => r.width >= 1 && r.height >= 1;
    const presentBox = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none") return false;
      return visible(el.getBoundingClientRect());
    };
    const painted = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
      return visible(el.getBoundingClientRect());
    };
    const overlayLayer = (el) => {
      const style = window.getComputedStyle(el);
      return style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
    };
    const pushBox = (el, requirePainted) => {
      if (root.contains(el)) return;
      if (requirePainted ? !painted(el) : !presentBox(el)) return;
      const r = el.getBoundingClientRect();
      overlayBoxes.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    };

    for (const el of dialogEls) {
      const style = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (diagSamples.length < 3) {
        diagSamples.push({
          inRoot: root.contains(el),
          opacity: style.opacity,
          visibility: style.visibility,
          display: style.display,
          position: style.position,
          w: Math.round(r.width),
          h: Math.round(r.height),
          role: el.getAttribute("role"),
          ariaModal: el.getAttribute("aria-modal"),
        });
      }
      // Dialogs / aria-modal : taille suffit (opacity 0 géré par preparePortalOverlaysForCapture)
      pushBox(el, false);
    }

    for (const child of Array.from(document.body.children)) {
      if (child === root || child.id === "storybook-root") continue;
      if (skipTag[child.tagName]) continue;
      if (child.id === "storybook-docs" && child.childElementCount === 0) continue;
      if (overlayLayer(child) && painted(child)) pushBox(child, true);
      for (const el of Array.from(child.querySelectorAll("*"))) {
        if (overlayLayer(el) && painted(el)) pushBox(el, true);
      }
    }

    const diag = {
      dialogCount: dialogEls.length,
      overlayBoxCount: overlayBoxes.length,
      bodyChildCount: document.body.children.length,
      samples: diagSamples,
    };

    if (overlayBoxes.length === 0) {
      return { clip: null, viewport: { width: window.innerWidth, height: window.innerHeight }, diag };
    }

    const rootRect = root.getBoundingClientRect();
    let union = visible(rootRect)
      ? { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height }
      : null;

    for (const box of overlayBoxes) {
      if (!union) {
        union = box;
        continue;
      }
      const left = Math.min(union.x, box.x);
      const top = Math.min(union.y, box.y);
      const right = Math.max(union.x + union.width, box.x + box.width);
      const bottom = Math.max(union.y + union.height, box.y + box.height);
      union = { x: left, y: top, width: right - left, height: bottom - top };
    }

    if (!union) return { clip: null, viewport: { width: window.innerWidth, height: window.innerHeight }, diag };
    return {
      clip: union,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      diag,
    };
  })()`)) as {
    clip: { x: number; y: number; width: number; height: number } | null;
    viewport: { width: number; height: number } | null;
    diag?: Record<string, unknown>;
  } | null;

  if (!raw?.clip || !raw.viewport) return null;
  return clampCaptureClipToViewport(raw.clip, raw.viewport);
};

/** Une frame PNG : root serré, ou clip élargi si modals / portals hors root. */
export const captureStoryFrame = async (page: Page): Promise<Buffer> => {
  await preparePortalOverlaysForCapture(page);
  const expandedClip = await resolveExpandedCaptureClip(page);
  if (expandedClip) {
    // Pas `animations: "disabled"` : Playwright peut remettre le fade RNW à opacity 0.
    await preparePortalOverlaysForCapture(page);
    return page.screenshot({ type: "png", clip: expandedClip });
  }
  return page.locator("#storybook-root").screenshot({ type: "png", animations: "disabled" });
};

/** Capture burst : N frames → sélection consensus (paire identique ou frame la plus stable). */
export const captureWithBurst = async (page: Page, config: VrConfig, outputPath: string): Promise<void> => {
  const frameCount = Math.max(2, config.stabilize.burstFrames);
  const interval = Math.max(0, config.stabilize.burstIntervalMs);
  const threshold = config.compare.threshold;
  const frames: Buffer[] = [];

  for (let i = 0; i < frameCount; i++) {
    frames.push(await captureStoryFrame(page));
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

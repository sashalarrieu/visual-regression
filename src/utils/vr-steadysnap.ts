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
  VR_CAPTURE_CLASSIC_SCROLLBAR_CSS,
  VR_CAPTURE_FOCUS_RESET_CSS,
  VR_CAPTURE_FOCUS_RESET_STYLE_ID,
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

const NEAR_WHITE_CAPTURE = 250;

/** Retire les bandes 100% blanches en bas du PNG (page hors story) sans toucher au layout / scroll. */
export const trimTrailingWhitePng = (pngBuffer: Buffer): Buffer => {
  const img = PNG.sync.read(pngBuffer);
  const { width, height, data } = img;
  const isWhitePx = (offset: number) =>
    data[offset] >= NEAR_WHITE_CAPTURE &&
    data[offset + 1] >= NEAR_WHITE_CAPTURE &&
    data[offset + 2] >= NEAR_WHITE_CAPTURE;

  let maxY = height - 1;
  outer: for (; maxY >= 0; maxY--) {
    const row = maxY * width * 4;
    for (let x = 0; x < width; x++) {
      if (!isWhitePx(row + x * 4)) break outer;
    }
  }
  const newHeight = maxY + 1;
  if (newHeight <= 0 || newHeight === height) return pngBuffer;

  const out = new PNG({ width, height: newHeight });
  data.copy(out.data, 0, 0, newHeight * width * 4);
  return PNG.sync.write(out);
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

/**
 * Neutralise l’anneau :focus laissé par `play()` (CSS uniquement).
 * Pas de `blur()` : ça fermerait les listes d’autocomplete encore ouvertes.
 */
export const applyCaptureFocusReset = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ css, styleId }) => {
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = css;
    },
    { css: VR_CAPTURE_FOCUS_RESET_CSS, styleId: VR_CAPTURE_FOCUS_RESET_STYLE_ID },
  );
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
 * Helpers DOM (string evaluate) : chrome Storybook vs overlay métier réellement ouvert.
 * Une Modal RNW fermée reste souvent un dialog full-viewport opacity 0 — si on l'inclut
 * (ou qu'on force opacity:1), le PNG devient une page blanche + le trigger en fond,
 * classé en fail visuel au lieu d'une capture invalide.
 */
const VR_CAPTURE_SURFACE_HELPERS_JS = `
  const storybookChromeSelector = ".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-errordisplay, #error-message, #error-stack";
  const isStorybookChrome = (el) => Boolean(el && el.closest && el.closest(storybookChromeSelector));
  const isPaintedBox = (style, box) =>
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0 &&
    box.width >= 1 &&
    box.height >= 1;
  const isStorybookPreparing = () => {
    const body = document.body;
    if (!body) return false;
    if (body.classList.contains("sb-show-preparing-story")) return true;
    if (body.classList.contains("sb-show-preparing-docs")) return true;
    if (body.classList.contains("sb-show-nopreview")) return true;
    for (const el of Array.from(document.querySelectorAll(".sb-preparing-story, .sb-preparing-docs, .sb-nopreview"))) {
      if (isPaintedBox(getComputedStyle(el), el.getBoundingClientRect())) return true;
    }
    return false;
  };
  const hasMeaningfulContent = (el) => {
    const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text.length > 0) return true;
    return Boolean(el.querySelector("img, svg, canvas, video, [role='img']"));
  };
  const coversViewportBox = (box) =>
    box.width >= window.innerWidth - 2 && box.height >= window.innerHeight - 2;
  const isOverlayLayer = (el) => {
    const style = getComputedStyle(el);
    return style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
  };
  const isDialogLike = (el) =>
    Boolean(el && (el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true"));
  // Feuille dialog uniquement — pas l'hôte RNW (bbox souvent 0 car le dialog est position:fixed).
  const isClosedDialogLeaf = (el) => {
    if (!el || isStorybookChrome(el)) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(el);
    if (style.display === "none") return true;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return true;
    if (style.visibility === "hidden" && Number(style.opacity) === 0) return true;
    if (coversViewportBox(box) && !hasMeaningfulContent(el)) return true;
    if (Number(style.opacity) === 0 && style.pointerEvents === "none" && !hasMeaningfulContent(el)) return true;
    return false;
  };
  const containsOpenPortalDialog = (el) => {
    if (!el) return false;
    const nodes = isDialogLike(el)
      ? [el, ...Array.from(el.querySelectorAll('[role="dialog"], [aria-modal="true"]'))]
      : Array.from(el.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    return nodes.some(node => !isClosedDialogLeaf(node) && hasMeaningfulContent(node));
  };
  const isClosedOrEmptyPortal = (el) => {
    if (!el || isStorybookChrome(el)) return true;
    if (containsOpenPortalDialog(el)) return false;
    return isClosedDialogLeaf(el);
  };
  const isOpenPortalOverlay = (el) => !isClosedOrEmptyPortal(el);
  const rootHasStoryContent = (root) => {
    const text = (root.innerText || "").replace(/\\s+/g, " ").trim();
    if (text.length > 0) return true;
    return Boolean(root.querySelector("img, svg, canvas, video, input, textarea, [role='img'], [role='button']"));
  };
`;

/**
 * Surface capturable : story rendue dans `#storybook-root` **ou** dialog portailé.
 * `play()` ouvre souvent une Modal RNW qui masque le root (`visibility` / bbox 0) —
 * exiger `visible=true` sur le root fait alors timeout alors que la modale est prête.
 * String evaluate : tsx keepNames casse les fonctions sérialisées par Playwright.
 */
export const STORY_CAPTURE_SURFACE_READY_JS = `() => {
  ${VR_CAPTURE_SURFACE_HELPERS_JS}
  const body = document.body;
  const previewError = body?.classList.contains("sb-show-errordisplay")
    ? (document.getElementById("error-message")?.textContent || "").trim()
    : "";
  if (previewError) {
    throw new Error("Storybook preview error: " + previewError);
  }
  if (body?.classList.contains("sb-show-nopreview")) {
    throw new Error("Storybook n'a pas rendu la story (nopreview)");
  }
  if (isStorybookPreparing()) return false;
  const root = document.querySelector("#storybook-root");
  if (!root || root.children.length === 0) return false;
  const rootStyle = getComputedStyle(root);
  const rootBox = root.getBoundingClientRect();
  const rootPainted =
    rootBox.width >= 1 &&
    rootBox.height >= 1 &&
    rootStyle.display !== "none" &&
    rootStyle.visibility !== "hidden";
  const openPortal = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some((el) => {
    if (root.contains(el)) return false;
    return isOpenPortalOverlay(el);
  });
  if (openPortal) return true;
  if (rootPainted && rootHasStoryContent(root)) return true;
  return false;
}`;

/** Après stabilisation : overlay preparing / nopreview / root vide → erreur de capture, pas un PNG blanc. */
export const STORY_CAPTURE_ASSERT_SURFACE_JS = `() => {
  ${VR_CAPTURE_SURFACE_HELPERS_JS}
  const body = document.body;
  const previewError = body?.classList.contains("sb-show-errordisplay")
    ? (document.getElementById("error-message")?.textContent || "").trim()
    : "";
  if (previewError) {
    throw new Error("Storybook preview error: " + previewError);
  }
  if (isStorybookPreparing()) {
    throw new Error("Storybook preview still preparing — story not loaded");
  }
  const root = document.querySelector("#storybook-root");
  if (!root || root.children.length === 0) {
    throw new Error("Storybook #storybook-root is empty — story not loaded");
  }
  const openPortal = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some((el) => {
    if (root.contains(el)) return false;
    return isOpenPortalOverlay(el);
  });
  const rootStyle = getComputedStyle(root);
  const rootBox = root.getBoundingClientRect();
  const rootPainted =
    rootBox.width >= 1 &&
    rootBox.height >= 1 &&
    rootStyle.display !== "none" &&
    rootStyle.visibility !== "hidden";
  if (!rootPainted && !openPortal) {
    throw new Error("Story capture surface is blank (root unpainted, no open portal)");
  }
  if (!openPortal && !rootHasStoryContent(root)) {
    throw new Error("Storybook #storybook-root has no visible content — story not loaded");
  }
  return true;
}`;

/** Options SteadySnap par story (ex. `parameters.vr.showScrollbars`). */
export type WaitForStoryStableOptions = {
  showScrollbars?: boolean;
};

/**
 * Overlay Chromium → barres classiques sur les nœuds qui overflow vraiment
 * (`overflow: hidden` inchangé — ex. autoDisableScrollable contenu court).
 */
export const APPLY_CLASSIC_SCROLLBARS_JS = `(() => {
  const threshold = 2;
  const canScroll = (value) => value === "auto" || value === "overlay" || value === "scroll" || value === "hidden";
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const style = window.getComputedStyle(el);
    if (canScroll(style.overflowY) && el.scrollHeight > el.clientHeight + threshold) {
      el.style.setProperty("overflow-y", "scroll", "important");
    }
    if (canScroll(style.overflowX) && el.scrollWidth > el.clientWidth + threshold) {
      el.style.setProperty("overflow-x", "scroll", "important");
    }
  }
})()`;

/**
 * Attente composite SteadySnap : root, fonts, images, data-vr-ready, freeze CSS, network quiet.
 */
export const waitForStoryStable = async (
  page: Page,
  config: VrConfig,
  tracker?: NetworkQuietTracker,
  storyTags: string[] = [],
  options?: WaitForStoryStableOptions,
): Promise<void> => {
  const captureTimeout = config.capture.maxTestTime;
  const maxStabilize = config.stabilize.maxStabilizeTime;
  const budget = maxStabilize > 0 ? Math.min(maxStabilize, captureTimeout) : captureTimeout;
  const deadline = Date.now() + budget;
  const stepTimeout = (): number => Math.max(500, remainingMs(deadline));
  const expectsPlay = expectsVrStoryPlay(storyTags);

  await page.waitForSelector("#storybook-root", { state: "attached", timeout: stepTimeout() });

  if (config.stabilize.waitFonts) {
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });
  }

  await page.waitForFunction(STORY_CAPTURE_SURFACE_READY_JS, { timeout: stepTimeout() });

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
    ${VR_CAPTURE_SURFACE_HELPERS_JS}
    const root = document.querySelector("#storybook-root");
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some((el) => {
      if (root && root.contains(el)) return false;
      return isOpenPortalOverlay(el);
    });
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

  await applyCaptureFocusReset(page);

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

  if (options?.showScrollbars) {
    await page.addStyleTag({ content: VR_CAPTURE_CLASSIC_SCROLLBAR_CSS });
    await page.evaluate(APPLY_CLASSIC_SCROLLBARS_JS);
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

export const preparePortalOverlaysForCapture = async (page: Page): Promise<void> => {
  // Soften only: kill CSS animation/transition on dialog shells.
  // Do NOT force opacity:1 on every descendant — that turns RNW black backdrops
  // (rgb(0,0,0) at animated opacity 0) into a full-viewport black screenshot.
  // Hide closed / empty full-viewport shells (page blanche par-dessus le crop root).
  await page.evaluate(`(() => {
    ${VR_CAPTURE_SURFACE_HELPERS_JS}
    const root = document.querySelector("#storybook-root");
    const hideOverlay = (node) => {
      node.style.setProperty("visibility", "hidden", "important");
      node.style.setProperty("opacity", "0", "important");
      node.style.setProperty("pointer-events", "none", "important");
    };
    const softForce = (node) => {
      node.style.setProperty("animation", "none", "important");
      node.style.setProperty("transition", "none", "important");
    };
    for (const el of Array.from(document.querySelectorAll(".sb-preparing-story, .sb-preparing-docs, .sb-nopreview"))) {
      hideOverlay(el);
    }
    for (const el of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
      if (root && root.contains(el)) continue;
      if (containsOpenPortalDialog(el)) continue;
      if (isClosedOrEmptyPortal(el)) {
        hideOverlay(el);
        continue;
      }
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
    for (const child of Array.from(document.body.children)) {
      if (child === root || child.id === "storybook-root") continue;
      if (root && child.contains(root)) continue;
      // Hôte RNW : bbox 0×N (dialog en position:fixed). Le masquer cache la modale ouverte.
      if (containsOpenPortalDialog(child)) continue;
      if (isStorybookChrome(child) || isClosedOrEmptyPortal(child)) hideOverlay(child);
      else if (isOverlayLayer(child) && coversViewportBox(child.getBoundingClientRect())) hideOverlay(child);
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
    ${VR_CAPTURE_SURFACE_HELPERS_JS}
    const root = document.querySelector("#storybook-root");
    if (!root) return { clip: null, viewport: null, diag: { noRoot: true } };

    const overlayBoxes = [];
    const skipTag = { SCRIPT: 1, STYLE: 1, LINK: 1, NOSCRIPT: 1, META: 1, TEMPLATE: 1 };
    const dialogEls = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    const diagSamples = [];

    const visible = (r) => r.width >= 1 && r.height >= 1;
    const painted = (el) => {
      if (isStorybookChrome(el) || isClosedOrEmptyPortal(el)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
      return visible(el.getBoundingClientRect());
    };
    const overlayLayer = (el) => isOverlayLayer(el);
    const pushBox = (el, requireOpenPortal) => {
      if (root.contains(el)) return;
      if (isStorybookChrome(el)) return;
      if (requireOpenPortal ? !isOpenPortalOverlay(el) : !painted(el)) return;
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
          ariaHidden: el.getAttribute("aria-hidden"),
          closed: isClosedOrEmptyPortal(el),
        });
      }
      // Dialog ouvert (contenu réel) seulement — pas les shells RNW fermés / page blanche.
      pushBox(el, true);
    }

    for (const child of Array.from(document.body.children)) {
      if (child === root || child.id === "storybook-root") continue;
      if (skipTag[child.tagName]) continue;
      if (isStorybookChrome(child)) continue;
      if (child.id === "storybook-docs" && child.childElementCount === 0) continue;
      // Page blanche hors story : calque plein viewport sans dialog ouvert — ne pas élargir le clip.
      if (isOverlayLayer(child) && coversViewportBox(child.getBoundingClientRect()) && !containsOpenPortalDialog(child)) {
        continue;
      }
      if (overlayLayer(child) && painted(child) && containsOpenPortalDialog(child)) pushBox(child, false);
      for (const el of Array.from(child.querySelectorAll("*"))) {
        if (overlayLayer(el) && painted(el) && containsOpenPortalDialog(el)) pushBox(el, false);
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
export type CaptureStoryFrameOptions = {
  clipMode?: "auto" | "root";
};

export const captureStoryFrame = async (page: Page, options?: CaptureStoryFrameOptions): Promise<Buffer> => {
  await page.evaluate(STORY_CAPTURE_ASSERT_SURFACE_JS);
  await applyCaptureFocusReset(page);
  await preparePortalOverlaysForCapture(page);
  if (options?.clipMode !== "root") {
    const expandedClip = await resolveExpandedCaptureClip(page);
    if (expandedClip) {
      // Pas `animations: "disabled"` : Playwright peut remettre le fade RNW à opacity 0.
      await preparePortalOverlaysForCapture(page);
      return trimTrailingWhitePng(await page.screenshot({ type: "png", clip: expandedClip }));
    }
  }
  try {
    return trimTrailingWhitePng(
      await page.locator("#storybook-root").screenshot({ type: "png", animations: "disabled" }),
    );
  } catch (error) {
    const openPortal = (await page.evaluate(`(() => {
      ${VR_CAPTURE_SURFACE_HELPERS_JS}
      const root = document.querySelector("#storybook-root");
      return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some((el) => {
        if (root && root.contains(el)) return false;
        return isOpenPortalOverlay(el);
      });
    })()`)) as boolean;
    if (!openPortal) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Impossible de capturer #storybook-root (story non chargée ou hors écran): ${errMsg}`);
    }
    // Root masqué par une Modal RNW ouverte — viewport plutôt qu’échec.
    return trimTrailingWhitePng(await page.screenshot({ type: "png", animations: "disabled" }));
  }
};

/** Capture burst : N frames → sélection consensus (paire identique ou frame la plus stable). */
export const captureWithBurst = async (
  page: Page,
  config: VrConfig,
  outputPath: string,
  options?: CaptureStoryFrameOptions,
): Promise<void> => {
  const frameCount = Math.max(2, config.stabilize.burstFrames);
  const interval = Math.max(0, config.stabilize.burstIntervalMs);
  const threshold = config.compare.threshold;
  const frames: Buffer[] = [];

  for (let i = 0; i < frameCount; i++) {
    frames.push(await captureStoryFrame(page, options));
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

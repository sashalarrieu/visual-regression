import type { Decorator } from "@storybook/react-webpack5";
import { useEffect, type JSX, type ReactNode } from "react";
import { addons } from "storybook/preview-api";

import {
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
  VR_CAPTURE_ANIMATION_FREEZE_CSS,
  VR_CAPTURE_FOCUS_RESET_CSS,
  VR_CAPTURE_FOCUS_RESET_STYLE_ID,
  VR_PLAY_AUTOPLAY_GRACE_MS,
  VR_PLAY_FALLBACK_TIMEOUT_MS,
} from "../constants/constants";
import {
  formatVrPlayError,
  hasVisiblePortalDialogOutsideRoot,
  resolveStoryPlayFunction,
  runVrStoryPlay,
  shouldReplayVrStoryPlay,
  type VrStoryPlayFunction,
  type VrStoryPlayRunnerStatus,
} from "../utils/vr-story-play";

import { patchStorybookFocusForDocs } from "./patch-storybook-focus";
import { applyClassicScrollbarsInPage } from "./play-helpers";

// Storybook 10.5+ : sans ce patch, addon-docs crash (Illegal invocation sur focus).
patchStorybookFocusForDocs();

declare global {
  interface Window {
    /** true quand la story est capturée par Playwright (SteadySnap). */
    __VR_CAPTURE__?: boolean;
  }
}

if (typeof window !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  window.__VR_CAPTURE__ = params.get("vr-capture") === "1" || process.env.VR_CAPTURE === "1";
}

const VR_CAPTURE_FREEZE_STYLE_ID = "vr-capture-animation-freeze";

const injectCaptureStyle = (id: string, css: string): (() => void) => {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
};

/** Fige les animations CSS pendant la capture VR (sans import Reanimated dans ce entry). */
const VrCaptureAnimationFreeze = ({ active, children }: { active: boolean; children: ReactNode }) => {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    return injectCaptureStyle(VR_CAPTURE_FREEZE_STYLE_ID, VR_CAPTURE_ANIMATION_FREEZE_CSS);
  }, [active]);

  return <>{children}</>;
};

/** Outline / caret : Playwright laisse le focus après play() (anneau noir Chromium). */
const VrCaptureFocusReset = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    if (typeof document === "undefined") return;
    return injectCaptureStyle(VR_CAPTURE_FOCUS_RESET_STYLE_ID, VR_CAPTURE_FOCUS_RESET_CSS);
  }, []);

  return <>{children}</>;
};

/** Neutralise l’anneau :focus en capture (Playwright + Chromium Linux). */
export const withVrCaptureFocusReset: Decorator = Story => {
  const inCapture = typeof window !== "undefined" && window.__VR_CAPTURE__ === true;
  if (!inCapture) {
    return <Story />;
  }

  return (
    <VrCaptureFocusReset>
      <Story />
    </VrCaptureFocusReset>
  );
};

/** Fige les animations en capture VR sauf stories taguées `live-animation-vr`. */
export const withVrReanimatedFreeze: Decorator = (Story, context) => {
  const inCapture = typeof window !== "undefined" && window.__VR_CAPTURE__ === true;
  const keepLiveAnimation = context.tags?.includes(LIVE_ANIMATION_VR_TAG) ?? false;
  const shouldFreeze = inCapture && !keepLiveAnimation;

  if (!shouldFreeze) {
    return <Story />;
  }

  return (
    <VrCaptureAnimationFreeze active>
      <Story />
    </VrCaptureAnimationFreeze>
  );
};

type VrStoryPlayRunnerProps = {
  Story: () => JSX.Element;
  context: {
    id?: string;
    tags?: string[];
    playFunction?: VrStoryPlayFunction;
    parameters?: { vr?: { showScrollbars?: boolean } };
  } & Record<string, unknown>;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * En capture VR : exécute `play()` après les `useEffect` de sync (embed=true coupe l’autoplay).
 * Un second play sur un DOM déjà muté casse spies et findBy*. On ne rejoue que si
 * Storybook n’a pas vraiment joué. Un dialog 0×0 (Modal fermée) n’empêche pas le replay.
 */
const VrStoryPlayRunner = ({ Story, context }: VrStoryPlayRunnerProps) => {
  useEffect(() => {
    const root = document.getElementById("storybook-root");
    if (!root) return;

    let cancelled = false;
    root.setAttribute("data-vr-ready", "false");
    root.removeAttribute("data-vr-error");

    const channel = addons.getChannel();
    // Objet mutable : TS ne voit pas les écritures async des handlers channel.
    const sb = {
      status: "pending" as VrStoryPlayRunnerStatus,
      playStarted: false,
      error: undefined as unknown,
    };

    const onStoryFinished = (payload: { storyId?: string; status?: string }) => {
      if (payload?.storyId !== context.id) return;
      sb.status = payload.status === "success" ? "success" : "error";
    };

    const onPlayException = (payload: { storyId?: string; error?: unknown }) => {
      if (payload?.storyId !== context.id) return;
      console.error("[VR] play() failed:", payload.error);
      sb.playStarted = true;
      sb.status = "error";
      sb.error = payload.error;
    };

    const onRenderPhase = (payload: { storyId?: string; newPhase?: string }) => {
      if (payload?.storyId !== context.id) return;
      if (payload.newPhase === "playing" || payload.newPhase === "played") {
        sb.playStarted = true;
      }
    };

    channel.on("storyFinished", onStoryFinished);
    channel.on("playFunctionThrewException", onPlayException);
    channel.on("storyRenderPhaseChanged", onRenderPhase);

    const mark = (state: "true" | "error", error?: unknown) => {
      if (cancelled) return;
      root.setAttribute("data-vr-ready", state);
      if (state === "error") {
        const message = formatVrPlayError(error);
        if (message) root.setAttribute("data-vr-error", message.slice(0, 500));
      } else {
        root.removeAttribute("data-vr-error");
      }
    };

    void (async () => {
      try {
        const graceSteps = Math.max(1, Math.ceil(VR_PLAY_AUTOPLAY_GRACE_MS / 50));
        for (let i = 0; i < graceSteps; i++) {
          if (cancelled) return;
          if (sb.playStarted || sb.status !== "pending") break;
          await sleep(50);
        }

        if (cancelled) return;
        if (sb.status === "error") {
          mark("error", sb.error);
          return;
        }

        if (
          shouldReplayVrStoryPlay({
            hasPortal: hasVisiblePortalDialogOutsideRoot(),
            playStarted: sb.playStarted,
          })
        ) {
          try {
            await Promise.race([
              runVrStoryPlay(context),
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new Error(`VR play() timeout (${VR_PLAY_FALLBACK_TIMEOUT_MS}ms)`)),
                  VR_PLAY_FALLBACK_TIMEOUT_MS,
                );
              }),
            ]);
          } catch (error) {
            console.error("[VR] play() fallback failed:", error);
            mark("error", error);
            return;
          }
        } else if (sb.playStarted && sb.status === "pending") {
          const deadline = Date.now() + VR_PLAY_FALLBACK_TIMEOUT_MS;
          while (!cancelled && sb.status === "pending" && Date.now() < deadline) {
            await sleep(50);
          }
          if (cancelled) return;
          // Relecture : TS ne voit pas les mutations async des handlers channel.
          const statusAfterWait = sb.status as VrStoryPlayRunnerStatus;
          if (statusAfterWait === "error") {
            mark("error", sb.error);
            return;
          }
          if (statusAfterWait === "pending") {
            mark("error", new Error(`VR play() timeout (${VR_PLAY_FALLBACK_TIMEOUT_MS}ms)`));
            return;
          }
        }

        if (cancelled) return;
        for (let i = 0; i < 6; i++) {
          if (cancelled) return;
          if (hasVisiblePortalDialogOutsideRoot()) break;
          await sleep(50);
        }
        if (cancelled) return;
        if (context.parameters?.vr?.showScrollbars) {
          applyClassicScrollbarsInPage();
        }
        mark("true");
      } catch (error) {
        console.error("[VR] play() runner failed:", error);
        mark("error", error);
      }
    })();

    return () => {
      cancelled = true;
      channel.off("storyFinished", onStoryFinished);
      channel.off("playFunctionThrewException", onPlayException);
      channel.off("storyRenderPhaseChanged", onRenderPhase);
    };
  }, [context.id, typeof context.playFunction]);

  return <Story />;
};

/** En capture VR : exécute `play()` avant le screenshot (attente via `data-vr-ready`). */
export const withVrStoryPlay: Decorator = (Story, context) => {
  const inCapture = typeof window !== "undefined" && window.__VR_CAPTURE__ === true;
  const skipPlay = context.tags?.includes(SKIP_PLAY_VR_TAG) ?? false;
  const playFn = resolveStoryPlayFunction(context as Record<string, unknown>);
  const taggedPlay = context.tags?.includes(PLAY_FN_TAG) ?? false;

  if (!inCapture || skipPlay || (!playFn && !taggedPlay)) {
    return <Story />;
  }

  return (
    <VrStoryPlayRunner
      Story={Story}
      context={context}
    />
  );
};

/** Decorators Storybook recommandés pour la capture VR (focus, Reanimated freeze, play()). */
export const vrPreviewDecorators: Decorator[] = [withVrCaptureFocusReset, withVrReanimatedFreeze, withVrStoryPlay];

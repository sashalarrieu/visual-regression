import type { Decorator } from "@storybook/react-webpack5";
import { useEffect, type JSX, type ReactNode } from "react";
import { addons } from "storybook/preview-api";

import {
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
  VR_CAPTURE_ANIMATION_FREEZE_CSS,
} from "../constants/constants";
import {
  formatVrPlayError,
  resolveStoryPlayFunction,
  runVrStoryPlay,
  shouldReplayVrStoryPlay,
  type VrStoryPlayFunction,
  type VrStoryPlayRunnerStatus,
} from "../utils/vr-story-play";

import { patchStorybookFocusForDocs } from "./patch-storybook-focus";

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

/** Fige les animations CSS pendant la capture VR (sans import Reanimated dans ce entry). */
const VrCaptureAnimationFreeze = ({ active, children }: { active: boolean; children: ReactNode }) => {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const style = document.createElement("style");
    style.id = VR_CAPTURE_FREEZE_STYLE_ID;
    style.textContent = VR_CAPTURE_ANIMATION_FREEZE_CSS;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [active]);

  return <>{children}</>;
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
  context: { id?: string; tags?: string[]; playFunction?: VrStoryPlayFunction } & Record<string, unknown>;
};

const hasPortalDialogOutsideRoot = (): boolean => {
  const root = document.getElementById("storybook-root");
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(
    el => !root || !root.contains(el),
  );
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * En capture VR : attend le play Storybook (et un portal s'il y en a).
 * L'URL de capture pose `embed=true` pour couper l'autoplay Storybook —
 * sinon `play()` s'exécute avant les `useEffect` (sync props→state) et l'UI
 * revient à l'état initial. On ne rejoue `play()` que s'il n'a pas tourné
 * (autoplay off / static no-op) : un second play casse spies et DOM déjà muté.
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
        // Laisse le play Storybook auto tenter d'ouvrir un portal (max ~2.5s).
        for (let i = 0; i < 50; i++) {
          if (cancelled) return;
          if (hasPortalDialogOutsideRoot()) {
            mark("true");
            return;
          }
          if (sb.status !== "pending") break;
          await sleep(50);
        }

        if (cancelled) return;
        if (hasPortalDialogOutsideRoot()) {
          mark("true");
          return;
        }

        // Play terminé : laisser un tick au portal RNW pour se monter.
        if (sb.status === "success") {
          for (let i = 0; i < 6; i++) {
            if (cancelled) return;
            if (hasPortalDialogOutsideRoot()) {
              mark("true");
              return;
            }
            await sleep(50);
          }
        }

        if (
          !shouldReplayVrStoryPlay({
            hasPortal: hasPortalDialogOutsideRoot(),
            playStarted: sb.playStarted,
          })
        ) {
          if (sb.status === "error") {
            mark("error", sb.error);
            return;
          }
          mark("true");
          return;
        }

        // Fallback : play Storybook absent / no-op / trop lent — on exécute nous-mêmes avec timeout.
        try {
          await Promise.race([
            runVrStoryPlay(context),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("VR play() timeout (6s)")), 6000);
            }),
          ]);
        } catch (error) {
          console.error("[VR] play() fallback failed:", error);
          mark("error", error);
          return;
        }

        if (cancelled) return;
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
  }, [context.id, context.playFunction]);

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

/** Decorators Storybook recommandés pour la capture VR (Reanimated freeze + play()). */
export const vrPreviewDecorators: Decorator[] = [withVrReanimatedFreeze, withVrStoryPlay];

import type { Decorator } from "@storybook/react-webpack5";
import { useEffect, type JSX } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { addons } from "storybook/preview-api";

import { LIVE_ANIMATION_VR_TAG, PLAY_FN_TAG, SKIP_PLAY_VR_TAG } from "../constants/constants";
import { resolveStoryPlayFunction, runVrStoryPlay, type VrStoryPlayFunction } from "../utils/vr-story-play";

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

/** Fige Reanimated en capture VR sauf stories taguées `live-animation-vr`. */
export const withVrReanimatedFreeze: Decorator = (Story, context) => {
  const inCapture = typeof window !== "undefined" && window.__VR_CAPTURE__ === true;
  const keepLiveAnimation = context.tags?.includes(LIVE_ANIMATION_VR_TAG) ?? false;
  const shouldFreeze = inCapture && !keepLiveAnimation;

  const shell = (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Story />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );

  if (shouldFreeze) {
    return (
      <>
        <ReducedMotionConfig mode={ReduceMotion.Always} />
        {shell}
      </>
    );
  }

  return shell;
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
 * En capture VR : attend un portal ouvert par le play Storybook, sinon rejoue `play()`
 * avec timeout (évite hang `findByText` → data-vr-ready bloqué à false).
 */
const VrStoryPlayRunner = ({ Story, context }: VrStoryPlayRunnerProps) => {
  useEffect(() => {
    const root = document.getElementById("storybook-root");
    if (!root) return;

    let cancelled = false;
    root.setAttribute("data-vr-ready", "false");

    const channel = addons.getChannel();
    // Objet mutable : TS ne voit pas les écritures async des handlers channel.
    const sb = { status: "pending" as "pending" | "success" | "error" };

    const onStoryFinished = (payload: { storyId?: string; status?: string }) => {
      if (payload?.storyId !== context.id) return;
      sb.status = payload.status === "success" ? "success" : "error";
    };

    const onPlayException = (payload: { storyId?: string; error?: unknown }) => {
      if (payload?.storyId !== context.id) return;
      console.error("[VR] play() failed:", payload.error);
      sb.status = "error";
    };

    channel.on("storyFinished", onStoryFinished);
    channel.on("playFunctionThrewException", onPlayException);

    const mark = (state: "true" | "error") => {
      if (!cancelled) root.setAttribute("data-vr-ready", state);
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
          if (sb.status === "error") {
            mark("error");
            return;
          }
          // SB a fini sans portal → on rejouera play ci-dessous
          if (sb.status === "success") break;
          await sleep(50);
        }

        if (cancelled) return;
        if (hasPortalDialogOutsideRoot()) {
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
          mark("error");
          return;
        }

        if (cancelled) return;
        // Stories play sans modal : ready quand même (pas de portal attendu).
        mark("true");
      } catch (error) {
        console.error("[VR] play() runner failed:", error);
        mark("error");
      }
    })();

    return () => {
      cancelled = true;
      channel.off("storyFinished", onStoryFinished);
      channel.off("playFunctionThrewException", onPlayException);
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

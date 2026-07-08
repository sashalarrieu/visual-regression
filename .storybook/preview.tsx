import type { Decorator, Preview } from "@storybook/react-webpack5";
import { useLayoutEffect, type JSX } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LIVE_ANIMATION_VR_TAG, SKIP_PLAY_VR_TAG } from "../src/constants/constants";
import { resolveStoryPlayFunction, runVrStoryPlay } from "../src/utils/vr-story-play";

import "react-native-reanimated";

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
const withVrReanimatedFreeze: Decorator = (Story, context) => {
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
  context: { id?: string } & Record<string, unknown>;
};

/** Exécute `play()` après le mount et signale `data-vr-ready` à Playwright. */
const VrStoryPlayRunner = ({ Story, context }: VrStoryPlayRunnerProps) => {
  useLayoutEffect(() => {
    const root = document.getElementById("storybook-root");
    if (!root) return;

    root.setAttribute("data-vr-ready", "false");

    let cancelled = false;

    void (async () => {
      try {
        await runVrStoryPlay(context as Record<string, unknown>);
      } catch (error) {
        console.error("[VR] play() failed:", error);
      } finally {
        if (!cancelled) root.setAttribute("data-vr-ready", "true");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.id]);

  return <Story />;
};

/** En capture VR : exécute `play()` avant le screenshot (attente via `data-vr-ready`). */
const withVrStoryPlay: Decorator = (Story, context) => {
  const inCapture = typeof window !== "undefined" && window.__VR_CAPTURE__ === true;
  const skipPlay = context.tags?.includes(SKIP_PLAY_VR_TAG) ?? false;
  const playFn = resolveStoryPlayFunction(context as Record<string, unknown>);

  if (!inCapture || skipPlay || !playFn) {
    return <Story />;
  }

  return (
    <VrStoryPlayRunner
      Story={Story}
      context={context}
    />
  );
};

const preview: Preview = {
  decorators: [withVrReanimatedFreeze, withVrStoryPlay],
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;

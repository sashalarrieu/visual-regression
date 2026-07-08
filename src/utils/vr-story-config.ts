/**
 * Config VR par story — `parameters.vr` dans CSF, fusionnée sur vr.config.cjs au capture.
 */
import type { Page } from "playwright";

import type { VrConfig, VrStoryParameters } from "@app-types/types";
import { BURST_VR_TAG } from "@constants/constants";
import { getDiffVerificationMaxAttempts } from "@utils/vr-diff-verify";

const pickPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
};

/** Normalise `parameters.vr` lu depuis Storybook (clés connues uniquement). */
export const normalizeStoryVrParameters = (raw: unknown): VrStoryParameters | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const source = raw as Record<string, unknown>;
  const result: VrStoryParameters = {};

  if (source.stabilize && typeof source.stabilize === "object" && !Array.isArray(source.stabilize)) {
    const st = source.stabilize as Record<string, unknown>;
    const stabilize: Partial<VrConfig["stabilize"]> = {};

    if (typeof st.freezeAnimations === "boolean") stabilize.freezeAnimations = st.freezeAnimations;
    if (typeof st.waitFonts === "boolean") stabilize.waitFonts = st.waitFonts;
    if (typeof st.burstCapture === "boolean") stabilize.burstCapture = st.burstCapture;

    const waitNetworkQuietMs = pickPositiveNumber(st.waitNetworkQuietMs);
    if (waitNetworkQuietMs !== undefined) stabilize.waitNetworkQuietMs = waitNetworkQuietMs;

    const burstFrames = pickPositiveNumber(st.burstFrames);
    if (burstFrames !== undefined) stabilize.burstFrames = burstFrames;

    const burstIntervalMs = pickPositiveNumber(st.burstIntervalMs);
    if (burstIntervalMs !== undefined) stabilize.burstIntervalMs = burstIntervalMs;

    const maxStabilizeTime = pickPositiveNumber(st.maxStabilizeTime);
    if (maxStabilizeTime !== undefined) stabilize.maxStabilizeTime = maxStabilizeTime;

    if (Object.keys(stabilize).length > 0) result.stabilize = stabilize;
  }

  const diffAttempts = pickPositiveNumber(source.diffVerificationMaxAttempts);
  if (diffAttempts !== undefined) result.diffVerificationMaxAttempts = diffAttempts;

  return Object.keys(result).length > 0 ? result : null;
};

/** Fusionne les overrides story sur la config globale résolue. */
export const resolveEffectiveVrConfig = (config: VrConfig, storyVr?: VrStoryParameters | null): VrConfig => {
  if (!storyVr) return config;

  return {
    ...config,
    compare: {
      ...config.compare,
      ...(storyVr.diffVerificationMaxAttempts !== undefined
        ? { diffVerificationMaxAttempts: storyVr.diffVerificationMaxAttempts }
        : {}),
    },
    stabilize: {
      ...config.stabilize,
      ...storyVr.stabilize,
    },
  };
};

/** Burst actif si config globale, tag, override story, ou param burst explicite (ex. burstIntervalMs). */
export const shouldUseBurstCapture = (
  config: VrConfig,
  storyTags: string[],
  storyVr?: VrStoryParameters | null,
): boolean => {
  if (storyVr?.stabilize?.burstCapture === true) return true;
  if (storyVr?.stabilize?.burstIntervalMs !== undefined || storyVr?.stabilize?.burstFrames !== undefined) {
    return true;
  }
  return config.stabilize.burstCapture || storyTags.includes(BURST_VR_TAG);
};

export const getStoryDiffVerificationMaxAttempts = (config: VrConfig, storyVr?: VrStoryParameters | null): number =>
  getDiffVerificationMaxAttempts(resolveEffectiveVrConfig(config, storyVr));

/** Lit `parameters.vr` depuis le store Storybook (iframe déjà chargée). */
export const readStoryVrParameters = async (page: Page, storyId: string): Promise<VrStoryParameters | null> => {
  const raw = await page.evaluate(async (id: string) => {
    const preview = (
      window as Window & {
        __STORYBOOK_PREVIEW__?: { storyStoreValue?: { loadStory?: (args: { storyId: string }) => Promise<unknown> } };
      }
    ).__STORYBOOK_PREVIEW__;
    const store = preview?.storyStoreValue;
    if (!store?.loadStory) return null;

    try {
      const story = (await store.loadStory({ storyId: id })) as { parameters?: { vr?: unknown } } | undefined;
      return story?.parameters?.vr ?? null;
    } catch {
      return null;
    }
  }, storyId);

  return normalizeStoryVrParameters(raw);
};

/**
 * Vérification diff multi-capture — relance jusqu'à match baseline ou max tentatives.
 */
import type { VrConfig } from "../types/types";

export type DiffVerifyOutcome = "match" | "new" | "diff" | "missing_temp";

export const getDiffVerificationMaxAttempts = (config: VrConfig): number =>
  Math.max(1, config.compare.diffVerificationMaxAttempts);

/** Relancer une capture complète tant qu'on a une diff et des tentatives restantes. */
export const shouldRetryDiffVerification = (
  attempt: number,
  outcome: DiffVerifyOutcome,
  maxAttempts: number,
): boolean => outcome === "diff" && attempt < maxAttempts;

export const formatDiffVerifyRetryLog = (nextAttempt: number, maxAttempts: number, screenshotKey: string): string =>
  `🔄 Diff verify attempt ${nextAttempt}/${maxAttempts} for ${screenshotKey}`;

export const formatFlakeSuppressedLog = (attempt: number, screenshotKey: string): string =>
  `✳️ Flake suppressed after attempt ${attempt} for ${screenshotKey}`;

export const formatDiffConfirmedLog = (maxAttempts: number, screenshotKey: string): string =>
  `⚠️  Diff confirmed after ${maxAttempts} attempts for ${screenshotKey}`;

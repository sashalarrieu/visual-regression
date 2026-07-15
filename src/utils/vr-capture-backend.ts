/**
 * Résolution du backend de capture VR.
 *
 * - "docker" (défaut) : toute capture est déléguée au daemon Docker (sidecar).
 * - "local" : capture Playwright directe (tests internes ou conteneur VR_DOCKER=1).
 */
import { CAPTURE_DAEMON_URL } from "../constants/constants";
import type { VrConfig } from "../types/types";

import { getProjectRoot } from "./node";
import { resolveVrConfig } from "./vr-config";

export type CaptureBackend = "docker" | "local";

const resolveConfig = (config?: VrConfig): VrConfig | undefined => {
  if (config) return config;
  try {
    return resolveVrConfig(getProjectRoot());
  } catch {
    return undefined;
  }
};

/** Backend résolu (VR_CAPTURE_BACKEND > vr.config capture.backend > docker). */
export const getCaptureBackend = (config?: VrConfig): CaptureBackend => {
  const envRaw = (process.env.VR_CAPTURE_BACKEND || "").toLowerCase();
  if (envRaw === "local" || envRaw === "docker") return envRaw;
  const resolved = resolveConfig(config);
  return resolved?.capture.backend ?? "docker";
};

/** true si les captures doivent passer par le daemon Docker. */
export const isDockerCaptureBackend = (config?: VrConfig): boolean => getCaptureBackend(config) === "docker";

/** true si le process courant s'exécute dans le conteneur de capture. */
export const isRunningInDocker = (): boolean => process.env.VR_DOCKER === "1";

/** URL du daemon de capture (VR_CAPTURE_DAEMON_URL > vr.config > défaut). */
export const getCaptureDaemonUrl = (config?: VrConfig): string => {
  const envUrl = process.env.VR_CAPTURE_DAEMON_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const resolved = resolveConfig(config);
  return (resolved?.capture.daemonUrl ?? CAPTURE_DAEMON_URL).replace(/\/$/, "");
};

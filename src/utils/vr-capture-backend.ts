/**
 * Résolution du backend de capture VR.
 *
 * - "docker" (défaut) : toute capture est déléguée au daemon Docker (sidecar).
 *   Aucune capture Playwright locale n'est autorisée sur la machine hôte.
 * - "local" : capture Playwright directe. Réservé aux tests internes du package
 *   et à l'exécution *à l'intérieur* du conteneur (VR_CAPTURE_BACKEND=local).
 */
import { CAPTURE_DAEMON_URL } from "@constants/constants";

export type CaptureBackend = "docker" | "local";

/** Backend résolu (VR_CAPTURE_BACKEND, défaut "docker"). */
export const getCaptureBackend = (): CaptureBackend => {
  const raw = (process.env.VR_CAPTURE_BACKEND || "docker").toLowerCase();
  return raw === "local" ? "local" : "docker";
};

/** true si les captures doivent passer par le daemon Docker. */
export const isDockerCaptureBackend = (): boolean => getCaptureBackend() === "docker";

/** true si le process courant s'exécute dans le conteneur de capture. */
export const isRunningInDocker = (): boolean => process.env.VR_DOCKER === "1";

/** URL du daemon de capture (sans slash final). */
export const getCaptureDaemonUrl = (): string =>
  (process.env.VR_CAPTURE_DAEMON_URL || CAPTURE_DAEMON_URL).replace(/\/$/, "");

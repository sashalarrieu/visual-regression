/**
 * Ports hôte du sidecar Docker, déterministes par racine projet.
 * À l'intérieur du conteneur, Storybook/daemon restent sur 6006/2810 ;
 * seul le mapping Compose utilise ces ports hôte.
 */
import { createHash } from "crypto";
import path from "path";

import { CAPTURE_DAEMON_PORT, LOCAL_URL, STORYBOOK_PORT } from "../constants/constants";

/** Plage Storybook hôte : 16000–16999. */
export const HOST_STORYBOOK_PORT_BASE = 16000;
/** Plage daemon hôte : 18000–18999. */
export const HOST_DAEMON_PORT_BASE = 18000;
const HOST_PORT_SLOT_COUNT = 1000;

/** URLs legacy / défauts package — traitées comme « non fixées » pour dériver les ports. */
export const SENTINEL_STORYBOOK_URL = `${LOCAL_URL}:${STORYBOOK_PORT}`;
export const SENTINEL_DAEMON_URL = `${LOCAL_URL}:${CAPTURE_DAEMON_PORT}`;

export type ProjectRootFingerprint = {
  resolved: string;
  /** sha1 hex 8 chars (nom Compose). */
  hash8: string;
  /** 0..999 pour les ports hôte. */
  slot: number;
};

export type HostSidecarPorts = {
  storybookPort: number;
  daemonPort: number;
  storybookUrl: string;
  daemonUrl: string;
  composeProjectName: string;
  slot: number;
};

export type HostSidecarPortOverrides = {
  /** URL Storybook déjà résolue (fichier + env). */
  storybookUrl?: string;
  /** URL daemon déjà résolue (fichier + env). */
  daemonUrl?: string;
};

const normalizeUrl = (url: string): string => url.trim().replace(/\/$/, "");

export const isSentinelStorybookUrl = (url: string | undefined): boolean => {
  if (!url?.trim()) return true;
  return normalizeUrl(url) === SENTINEL_STORYBOOK_URL;
};

export const isSentinelDaemonUrl = (url: string | undefined): boolean => {
  if (!url?.trim()) return true;
  return normalizeUrl(url) === SENTINEL_DAEMON_URL;
};

export const parseUrlPort = (url: string, fallback: number): number => {
  try {
    const port = new URL(url).port;
    return port ? Number(port) : fallback;
  } catch {
    return fallback;
  }
};

/** Empreinte stable d'une racine projet (Compose + ports). */
export const getProjectRootFingerprint = (projectRoot: string): ProjectRootFingerprint => {
  const resolved = path.resolve(projectRoot);
  const hash8 = createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  const slot = parseInt(hash8.slice(0, 4), 16) % HOST_PORT_SLOT_COUNT;
  return { resolved, hash8, slot };
};

/** Nom Compose unique par racine (partagé avec vr-docker). */
export const getComposeProjectNameForRoot = (projectRoot: string): string => {
  const { resolved, hash8 } = getProjectRootFingerprint(projectRoot);
  const base =
    path
      .basename(resolved)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return `vr-${base}-${hash8}`;
};

/**
 * Ports / URLs hôte pour le sidecar de ce projet.
 * Overrides non-sentinelle (config ou env déjà appliqués) sont respectés.
 */
export const getHostSidecarPorts = (projectRoot: string, overrides?: HostSidecarPortOverrides): HostSidecarPorts => {
  const { slot } = getProjectRootFingerprint(projectRoot);
  const derivedStorybookPort = HOST_STORYBOOK_PORT_BASE + slot;
  const derivedDaemonPort = HOST_DAEMON_PORT_BASE + slot;
  const derivedStorybookUrl = `${LOCAL_URL}:${derivedStorybookPort}`;
  const derivedDaemonUrl = `${LOCAL_URL}:${derivedDaemonPort}`;

  const storybookUrl = isSentinelStorybookUrl(overrides?.storybookUrl)
    ? derivedStorybookUrl
    : normalizeUrl(overrides!.storybookUrl!);
  const daemonUrl = isSentinelDaemonUrl(overrides?.daemonUrl) ? derivedDaemonUrl : normalizeUrl(overrides!.daemonUrl!);

  return {
    storybookPort: parseUrlPort(storybookUrl, derivedStorybookPort),
    daemonPort: parseUrlPort(daemonUrl, derivedDaemonPort),
    storybookUrl,
    daemonUrl,
    composeProjectName: getComposeProjectNameForRoot(projectRoot),
    slot,
  };
};

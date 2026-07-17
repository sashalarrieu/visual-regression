import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getComposeProjectNameForRoot,
  getHostSidecarPorts,
  getProjectRootFingerprint,
  HOST_DAEMON_PORT_BASE,
  HOST_STORYBOOK_PORT_BASE,
  isSentinelDaemonUrl,
  isSentinelStorybookUrl,
  SENTINEL_DAEMON_URL,
  SENTINEL_STORYBOOK_URL,
} from "./vr-sidecar-ports";

describe("getProjectRootFingerprint / getComposeProjectNameForRoot", () => {
  it("est stable pour une même racine", () => {
    const root = "/Users/me/Documents/dev/EIWIE_PRO_FRONTEND";
    const a = getProjectRootFingerprint(root);
    const b = getProjectRootFingerprint(path.join("/Users/me/Documents/dev", "EIWIE_PRO_FRONTEND"));
    expect(a.hash8).toBe(b.hash8);
    expect(a.slot).toBe(b.slot);
    expect(getComposeProjectNameForRoot(root)).toBe(getComposeProjectNameForRoot(b.resolved));
  });

  it("différencie deux projets", () => {
    const pro = getProjectRootFingerprint("/Users/me/Documents/dev/EIWIE_PRO_FRONTEND");
    const apps = getProjectRootFingerprint("/Users/me/Documents/dev/eiwie-frontend-apps");
    expect(pro.hash8).not.toBe(apps.hash8);
    expect(getComposeProjectNameForRoot("/Users/me/Documents/dev/EIWIE_PRO_FRONTEND")).not.toBe(
      getComposeProjectNameForRoot("/Users/me/Documents/dev/eiwie-frontend-apps"),
    );
  });
});

describe("getHostSidecarPorts", () => {
  it("dérive des ports distincts par projet dans les plages réservées", () => {
    const pro = getHostSidecarPorts("/Users/me/Documents/dev/EIWIE_PRO_FRONTEND");
    const apps = getHostSidecarPorts("/Users/me/Documents/dev/eiwie-frontend-apps");
    expect(pro.storybookPort).toBeGreaterThanOrEqual(HOST_STORYBOOK_PORT_BASE);
    expect(pro.storybookPort).toBeLessThan(HOST_STORYBOOK_PORT_BASE + 1000);
    expect(pro.daemonPort).toBeGreaterThanOrEqual(HOST_DAEMON_PORT_BASE);
    expect(pro.daemonPort).toBeLessThan(HOST_DAEMON_PORT_BASE + 1000);
    expect(pro.storybookPort).not.toBe(apps.storybookPort);
    expect(pro.daemonPort).not.toBe(apps.daemonPort);
    expect(pro.storybookUrl).toBe(`http://localhost:${pro.storybookPort}`);
    expect(pro.daemonUrl).toBe(`http://localhost:${pro.daemonPort}`);
  });

  it("traite les sentinelles 6006/2810 comme non fixées", () => {
    const derived = getHostSidecarPorts("/Users/me/proj");
    const withSentinel = getHostSidecarPorts("/Users/me/proj", {
      storybookUrl: SENTINEL_STORYBOOK_URL,
      daemonUrl: SENTINEL_DAEMON_URL,
    });
    expect(withSentinel.storybookPort).toBe(derived.storybookPort);
    expect(withSentinel.daemonPort).toBe(derived.daemonPort);
  });

  it("respecte des URLs custom non sentinelle", () => {
    const ports = getHostSidecarPorts("/Users/me/proj", {
      storybookUrl: "http://localhost:6100/",
      daemonUrl: "http://localhost:2910",
    });
    expect(ports.storybookPort).toBe(6100);
    expect(ports.daemonPort).toBe(2910);
    expect(ports.storybookUrl).toBe("http://localhost:6100");
    expect(ports.daemonUrl).toBe("http://localhost:2910");
  });
});

describe("isSentinel*", () => {
  it("détecte sentinelles et vide", () => {
    expect(isSentinelStorybookUrl(undefined)).toBe(true);
    expect(isSentinelStorybookUrl(SENTINEL_STORYBOOK_URL)).toBe(true);
    expect(isSentinelStorybookUrl("http://localhost:6100")).toBe(false);
    expect(isSentinelDaemonUrl(SENTINEL_DAEMON_URL)).toBe(true);
    expect(isSentinelDaemonUrl("http://localhost:2910")).toBe(false);
  });
});

describe("getHostSidecarPorts env isolation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("n'utilise pas process.env directement (overrides passés en arg)", () => {
    process.env.VR_STORYBOOK_URL = "http://localhost:9999";
    const ports = getHostSidecarPorts("/Users/me/proj");
    expect(ports.storybookPort).not.toBe(9999);
  });
});

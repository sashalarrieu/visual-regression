import { afterEach, describe, expect, it } from "vitest";

import {
  applySidecarPortResolution,
  applyEnvOverridesToVrConfig,
  applyStorybookConfigDirEnv,
  getDefaultVrConfig,
  mergeVrConfigFile,
} from "./vr-config";
import { getHostSidecarPorts } from "./vr-sidecar-ports";

const device = {
  name: "desktop-fhd",
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  isMobile: false,
};

describe("vr.config resolution", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses remoteChunkSize from file config", () => {
    const config = mergeVrConfigFile({ devices: [device], capture: { remoteChunkSize: 56 } });
    expect(config.capture.remoteChunkSize).toBe(56);
  });

  it("env VR_CAPTURE_REMOTE_CHUNK overrides file config", () => {
    process.env.VR_CAPTURE_REMOTE_CHUNK = "32";
    const config = applyEnvOverridesToVrConfig(
      mergeVrConfigFile({ devices: [device], capture: { remoteChunkSize: 56 } }),
    );
    expect(config.capture.remoteChunkSize).toBe(32);
  });

  it("defaults concurrencyDev to 2 and accepts file + env override", () => {
    expect(getDefaultVrConfig().capture.concurrencyDev).toBe(2);
    const fromFile = mergeVrConfigFile({ devices: [device], capture: { concurrencyDev: 4 } });
    expect(fromFile.capture.concurrencyDev).toBe(4);
    process.env.VR_CONCURRENCY_DEV = "6";
    expect(applyEnvOverridesToVrConfig(fromFile).capture.concurrencyDev).toBe(6);
  });

  it("defaults remoteChunkSize to 20", () => {
    expect(getDefaultVrConfig().capture.remoteChunkSize).toBe(20);
  });

  it("VR_CAPTURE_DEV_CONCURRENCY is an alias of VR_CONCURRENCY_DEV", () => {
    process.env.VR_CAPTURE_DEV_CONCURRENCY = "3";
    const config = applyEnvOverridesToVrConfig(mergeVrConfigFile({ devices: [device] }));
    expect(config.capture.concurrencyDev).toBe(3);
  });

  it("VR_CONCURRENCY overrides capture.concurrency (static/CI)", () => {
    process.env.VR_CONCURRENCY = "12";
    const config = applyEnvOverridesToVrConfig(mergeVrConfigFile({ devices: [device], capture: { concurrency: 8 } }));
    expect(config.capture.concurrency).toBe(12);
  });

  it("uses storybookMode from file config", () => {
    const config = mergeVrConfigFile({ devices: [device], launcher: { storybookMode: "static" } });
    expect(config.launcher.storybookMode).toBe("static");
  });

  it("maps VR_STORYBOOK_STATIC env to storybookMode static", () => {
    process.env.VR_STORYBOOK_STATIC = "1";
    const config = applyEnvOverridesToVrConfig(mergeVrConfigFile({ devices: [device] }));
    expect(config.launcher.storybookMode).toBe("static");
  });

  it("resolves capture backend from file then env", () => {
    const base = mergeVrConfigFile({ devices: [device], capture: { backend: "local" } });
    expect(base.capture.backend).toBe("local");
    process.env.VR_CAPTURE_BACKEND = "docker";
    expect(applyEnvOverridesToVrConfig(base).capture.backend).toBe("docker");
  });

  it("defaults docker.showLogs to false and accepts file + env override", () => {
    expect(getDefaultVrConfig().docker.showLogs).toBe(false);
    const fromFile = mergeVrConfigFile({ devices: [device], docker: { showLogs: true } });
    expect(fromFile.docker.showLogs).toBe(true);
    process.env.VR_DOCKER_SHOW_LOGS = "0";
    expect(applyEnvOverridesToVrConfig(fromFile).docker.showLogs).toBe(false);
  });

  it("dérive les ports hôte pour backend docker (sentinelles)", () => {
    delete process.env.VR_DOCKER;
    const base = mergeVrConfigFile({ devices: [device] });
    const resolved = applySidecarPortResolution(base, "/Users/me/Documents/dev/MyApp");
    const derived = getHostSidecarPorts("/Users/me/Documents/dev/MyApp");
    expect(resolved.storybook.url).toBe(derived.storybookUrl);
    expect(resolved.capture.daemonUrl).toBe(derived.daemonUrl);
  });

  it("force 6006/2810 quand VR_DOCKER=1", () => {
    process.env.VR_DOCKER = "1";
    const base = mergeVrConfigFile({
      devices: [device],
      storybook: { url: "http://localhost:16123" },
      capture: { daemonUrl: "http://localhost:18123" },
    });
    const resolved = applySidecarPortResolution(base, "/Users/me/Documents/dev/MyApp");
    expect(resolved.storybook.url).toBe("http://localhost:6006");
    expect(resolved.capture.daemonUrl).toBe("http://localhost:2810");
  });

  it("ne dérive pas les ports en backend local sur l'hôte", () => {
    delete process.env.VR_DOCKER;
    const base = mergeVrConfigFile({ devices: [device], capture: { backend: "local" } });
    const resolved = applySidecarPortResolution(base, "/Users/me/Documents/dev/MyApp");
    expect(resolved.storybook.url).toBe("http://localhost:6006");
  });

  it("applique storybook.configDir vers SBCONFIG_CONFIG_DIR", () => {
    delete process.env.SBCONFIG_CONFIG_DIR;
    const base = mergeVrConfigFile({
      devices: [device],
      storybook: { configDir: "apps/storybook/.storybook" },
    });
    applyStorybookConfigDirEnv("/Users/me/Documents/dev/MyApp", base);
    expect(process.env.SBCONFIG_CONFIG_DIR).toBe("/Users/me/Documents/dev/MyApp/apps/storybook/.storybook");
  });

  it("ne remplace pas SBCONFIG_CONFIG_DIR déjà défini", () => {
    process.env.SBCONFIG_CONFIG_DIR = "/custom/.storybook";
    const base = mergeVrConfigFile({
      devices: [device],
      storybook: { configDir: "apps/storybook/.storybook" },
    });
    applyStorybookConfigDirEnv("/Users/me/Documents/dev/MyApp", base);
    expect(process.env.SBCONFIG_CONFIG_DIR).toBe("/custom/.storybook");
  });
});

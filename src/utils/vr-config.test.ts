import { afterEach, describe, expect, it } from "vitest";

import { applyEnvOverridesToVrConfig, getDefaultVrConfig, mergeVrConfigFile } from "./vr-config";

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

  it("defaults remoteChunkSize to 20", () => {
    expect(getDefaultVrConfig().capture.remoteChunkSize).toBe(20);
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
});

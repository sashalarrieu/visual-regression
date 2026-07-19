import { describe, expect, it } from "vitest";

import { createTestVrConfig } from "./test-helpers";
import { shouldEchoHostCaptureLogs } from "./vr-capture-backend";

describe("shouldEchoHostCaptureLogs", () => {
  const originalEnv = { ...process.env };

  const restoreEnv = (): void => {
    process.env = { ...originalEnv };
  };

  it("echoes on local backend even when docker.showLogs is true", () => {
    restoreEnv();
    delete process.env.VR_CAPTURE_BACKEND;
    const config = createTestVrConfig({
      capture: { ...createTestVrConfig().capture, backend: "local" },
      docker: { ...createTestVrConfig().docker, showLogs: true },
    });
    expect(shouldEchoHostCaptureLogs(config)).toBe(true);
  });

  it("suppresses host echo when docker backend + showLogs", () => {
    restoreEnv();
    process.env.VR_CAPTURE_BACKEND = "docker";
    const config = createTestVrConfig({
      capture: { ...createTestVrConfig().capture, backend: "docker" },
      docker: { ...createTestVrConfig().docker, showLogs: true },
    });
    expect(shouldEchoHostCaptureLogs(config)).toBe(false);
  });

  it("echoes on docker backend when showLogs is false", () => {
    restoreEnv();
    process.env.VR_CAPTURE_BACKEND = "docker";
    const config = createTestVrConfig({
      capture: { ...createTestVrConfig().capture, backend: "docker" },
      docker: { ...createTestVrConfig().docker, showLogs: false },
    });
    expect(shouldEchoHostCaptureLogs(config)).toBe(true);
  });
});

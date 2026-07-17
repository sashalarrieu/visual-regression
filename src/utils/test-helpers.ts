import type { VrConfig } from "../types/types";

/** Config VR minimale pour les tests unitaires. */
export const createTestVrConfig = (overrides: Partial<VrConfig> = {}): VrConfig => ({
  devices: [
    {
      name: "desktop-fhd",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      isMobile: false,
    },
  ],
  capture: {
    concurrency: 8,
    concurrencyDev: 2,
    maxTestTime: 10_000,
    remoteChunkSize: 20,
    backend: "docker",
    daemonUrl: "http://localhost:2810",
  },
  compare: {
    mode: "incremental",
    base: "origin/main",
    scope: "all",
    includeWorkingTree: true,
    threshold: 0,
    diffVerificationMaxAttempts: 3,
    globalTriggers: [".storybook/**", "package.json", "yarn.lock", "vr.config.cjs"],
    statsFile: "storybook-static/preview-stats.json",
    manifestPath: ".vr-cache/manifest.json",
  },
  launcher: {
    runInitialCompare: true,
    forceStaticRebuild: false,
  },
  storybook: {
    url: "http://localhost:6006",
  },
  stabilize: {
    freezeAnimations: true,
    waitNetworkQuietMs: 0,
    waitFonts: true,
    burstCapture: false,
    burstFrames: 3,
    burstIntervalMs: 100,
    maxStabilizeTime: 5000,
  },
  docker: {
    image: "vr-capture:1.61.1",
    playwrightImage: "mcr.microsoft.com/playwright:v1.61.1-jammy",
    showLogs: false,
  },
  ...overrides,
});

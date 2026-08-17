/**
 * Configuration unifiée de la régression visuelle.
 * Utilisée par : vr-server, compare-visual-regressions, vr-launcher et l'UI.
 *
 * Hiérarchie : env var (VR_*) > ce fichier > défauts du package.
 */
module.exports = {
  devices: [
    {
      name: "desktop-fhd",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      isMobile: false,
      label: "Desktop FHD",
      icon: "laptop",
      color: "newTheme_primary",
    },
    {
      name: "iphone16",
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      label: "iPhone 16",
      icon: "phone-iphone",
      color: "newTheme_fantasy",
    },
    {
      name: "ipad-a16-portrait",
      viewport: { width: 834, height: 1194 },
      deviceScaleFactor: 2,
      isMobile: true,
      label: "iPad A16 Portrait",
      icon: "tablet-mac",
      color: "newTheme_warning",
    },
    {
      name: "ipad-a16-landscape",
      viewport: { width: 1194, height: 834 },
      deviceScaleFactor: 2,
      isMobile: true,
      label: "iPad A16 Paysage",
      icon: "tablet",
      color: "newTheme_info",
    },
  ],
  capture: {
    // static (local) + CI — override CI : VR_CONCURRENCY
    concurrency: 6,
    // Storybook dev (Vite) — override : VR_CONCURRENCY_DEV
    concurrencyDev: 4,
    maxTestTime: 10000,
    remoteChunkSize: 50,
  },
  compare: {
    mode: "incremental",
    base: "origin/dev",
    includeWorkingTree: true,
    threshold: 0,
    diffVerificationMaxAttempts: 3,
    globalTriggers: [".storybook/**", "package.json", "yarn.lock", "vr.config.cjs"],
    statsFile: "storybook-static/preview-stats.json",
    manifestPath: ".vr-cache/manifest.json",
  },
  launcher: {
    runInitialCompare: false,
  },
  docker: {
    showLogs: true,
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
};

/**
 * Constantes et valeurs fixes du package @setshao/visual-regression.
 * Partagées entre l'UI (src) et les scripts (scripts/).
 *
 * Configuration dynamique (devices, compare.mode, storybook.url, concurrency…) :
 * voir vr.config.cjs + resolveVrConfig() dans src/utils/vr-config.ts.
 *
 * Overrides env (scripts Node) — chaque clé a un équivalent vr.config.cjs (sauf VR_DOCKER, VR_PROJECT_ROOT) :
 *   VR_CONCURRENCY (static/CI), VR_CONCURRENCY_DEV (Storybook dev ; alias VR_CAPTURE_DEV_CONCURRENCY),
 *   VR_MAX_TEST_TIME, VR_CAPTURE_REMOTE_CHUNK,
 *   VR_CAPTURE_BACKEND, VR_CAPTURE_DAEMON_URL,
 *   VR_COMPARE_MODE, VR_COMPARE_BASE, VR_COMPARE_SCOPE, VR_THRESHOLD,
 *   VR_RUN_INITIAL_COMPARE, VR_STORYBOOK_URL, VR_STORYBOOK_MODE,
 *   VR_STORYBOOK_STATIC (alias → storybookMode), VR_STORYBOOK_STATIC_REBUILD, VR_DIFF_VERIFY_MAX_ATTEMPTS,
 *   VR_SHARD_INDEX, VR_SHARD_TOTAL,
 *   VR_DOCKER_IMAGE, VR_PLAYWRIGHT_IMAGE, VR_DOCKER_SHOW_LOGS
 */

import type { DeviceStyle } from "../types/types";

// --- Ports (launcher, serveur, Storybook, Expo) ---

export const EXPO_PORT = 2804;
export const STORYBOOK_PORT = 6006;
export const VR_SERVER_PORT = 2805;
/** Daemon de capture (sidecar Docker) : reçoit POST /capture/batch et sert GET /health. */
export const CAPTURE_DAEMON_PORT = 2810;

// --- API / serveur VR ---

export const LOCAL_URL = "http://localhost";
export const VR_SERVER_URL = `${LOCAL_URL}:${VR_SERVER_PORT}`;
export const EXPO_URL = `${LOCAL_URL}:${EXPO_PORT}`;
/** URL Storybook par défaut (UI). Les scripts utilisent resolveVrConfig().storybook.url. */
export const STORYBOOK_URL = `${LOCAL_URL}:${STORYBOOK_PORT}`;
/** URL par défaut du daemon de capture (override VR_CAPTURE_DAEMON_URL). */
export const CAPTURE_DAEMON_URL = `${LOCAL_URL}:${CAPTURE_DAEMON_PORT}`;

/** Style utilisé quand le device n'est pas trouvé dans la config. */
export const UNKNOWN_DEVICE_STYLE: DeviceStyle = { icon: "help-outline", color: "newTheme_danger" };

// --- Screenshots (noms, dossiers, extension) ---

export const SCREENSHOTS_DIR = "Screenshots";
export const SCREENSHOT_EXTENSION = ".png";
export const SCREENSHOT_NAME = ".screenshot" + SCREENSHOT_EXTENSION;
export const DIFF_SCREENSHOT_NAME = "__diff__";
export const TEMP_SCREENSHOT_NAME = "__temp__";
export const NEW_SCREENSHOT_NAME = "__new__";

// --- Arbre / chemins ---

export const TREE_BASE_FOLDER = "src";

// --- Storybook / comparaison ---

export const STORY_BASE_URI = `${STORYBOOK_URL}/iframe.html?id=`;

/** URL iframe Storybook pour une story (viewMode=story évite la page docs). */
export const getStoryIframeUrl = (storyId: string): string => `${STORY_BASE_URI}${storyId}&viewMode=story`;

// --- Tags stories (ignore / force VR) ---

export const IGNORE_VR_TAG = "ignore-vr";
export const FORCE_VR_TAG = "force-vr";
/** Active le burst SteadySnap sur une story flaky (override `stabilize.burstCapture: false`). */
export const BURST_VR_TAG = "burst-vr";
/** En capture VR : conserve les animations Reanimated (opt-out du freeze global preview). */
export const LIVE_ANIMATION_VR_TAG = "live-animation-vr";
/** En capture VR : n'exécute pas `play()` (opt-out du decorator preview). */
export const SKIP_PLAY_VR_TAG = "skip-play-vr";
/** Tag Storybook auto-appliqué aux stories avec `play()`. */
export const PLAY_FN_TAG = "play-fn";

// --- Logs console (launcher) ---

export const LOG_COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
} as const;

// --- DraggableImageCompare (UI) ---

export const CONTAINER_BORDER_WIDTH = 1;
export const HITBOX_BORDER = 100;
export const TOTAL_CONTAINER_BORDER_WIDTH = CONTAINER_BORDER_WIDTH * 2;
export const SEPARATOR_CONTAINER_OFFSET = TOTAL_CONTAINER_BORDER_WIDTH / 2 + 1;

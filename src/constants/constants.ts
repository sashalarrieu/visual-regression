/**
 * Constantes et valeurs fixes du package @setshao/visual-regression.
 * Partagées entre l'UI (src) et les scripts (scripts/).
 */

import type { DeviceStyle } from "@app-types/types";

// --- Ports (launcher, serveur, Storybook, Expo) ---

export const EXPO_PORT = 2804;
export const STORYBOOK_PORT = 6006;
export const VR_SERVER_PORT = 2805;

// --- API / serveur VR ---

export const LOCAL_URL = "http://localhost";
export const VR_SERVER_URL = `${LOCAL_URL}:${VR_SERVER_PORT}`;
export const EXPO_URL = `${LOCAL_URL}:${EXPO_PORT}`;
export const STORYBOOK_URL = `${LOCAL_URL}:${STORYBOOK_PORT}`;

/** Style utilisé quand le device n'est pas trouvé dans la config. */
export const UNKNOWN_DEVICE_STYLE: DeviceStyle = { icon: "hint", color: "newTheme_danger" };

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
export const MAX_TEST_TIME = 10000; // 10 sec
export const THRESHOLD = 0;

// --- Tags stories (ignore / force VR) ---

export const IGNORE_VR_TAG = "ignore-vr";
export const FORCE_VR_TAG = "force-vr";

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

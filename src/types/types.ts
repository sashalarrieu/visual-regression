/**
 * Types centralisés du package @setshao/visual-regression.
 * Domaine et context uniquement ; les props des composants restent dans chaque composant.
 */

import type { MaterialIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

export type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

// --- Domaine / config ---

/** Identifiant d'un device (clé utilisée dans l'API et les noms de fichiers). */
export type DeviceId = string;

/** Config d'affichage pour un device (label, icône, couleur dans l'UI). Passée à VisualRegressions via la prop devices. */
export type DeviceDisplayConfig = {
  name: DeviceId;
  label: string;
  icon: MaterialIconName;
  color: string;
};

/** Config complète d'un device : viewport (Playwright) + personnalisation affichage. Définie dans vr.config.cjs. */
export type VRDeviceConfig = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  label: string;
  icon: MaterialIconName;
  color: string;
};

/** Style d'affichage d'un device (icône + couleur). */
export type DeviceStyle = {
  icon: MaterialIconName;
  color: string;
};

// --- Arbre / régressions ---

export type StoryScreenshotsPath = {
  original?: string;
  temp?: string;
  diff?: string;
  new?: string;
};

export type Node = {
  type: "folder" | "file";
  name: string;
  path: string;
  children?: Record<string, Node>;
  storyType?: "new" | "diff";
  deviceName?: DeviceId;
  storyId?: string;
  displayName?: string;
  imagePaths?: StoryScreenshotsPath;
  imageUrls?: StoryScreenshotsPath;
  countPixelDiff?: number | null;
  countDiff?: number;
  countNew?: number;
  countTotal?: number;
};

/** Paire story + device pour les appels de comparaison. */
export type StoryDevicePair = {
  storyId: string;
  deviceName: string;
  /** Dossier composant relatif (ex. src/demo) — évite buildIndex Storybook lors de la régénération. */
  componentDir?: string;
};

/** Élément supprimé (corbeille), utilisé par le serveur VR et l'UI. */
export type DeletedItem = {
  isDiff: boolean;
  fullPath: string;
  imagePath: string;
  imageUrl?: string;
  folders: string[];
  fileName: string;
  label: string;
  deviceName?: string;
  storyId?: string;
  countPixelDiff?: number | null;
};

// --- Scripts (serveur VR, comparaison) ---

/** Chemin parsé d'un fichier screenshot (serveur VR). */
export type ParsedPath = {
  folders: string[];
  fileName: string;
  label: string;
  deviceName?: string;
};

/** Index en mémoire des régressions (serveur VR). */
export type RegressionIndex = {
  diffPaths: string[];
  newPaths: string[];
  deletedPaths: string[];
  tree: Node | null;
  deletedItems: DeletedItem[];
  lastUpdate: number;
};

/** Client SSE connecté au serveur VR. */
export type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController<string>;
};

/** Item device chargé depuis vr.config.cjs (scripts). */
export type VRDeviceConfigItem = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  label?: string;
  icon?: MaterialIconName;
  color?: string;
};

export type VrCompareMode = "incremental" | "full";

/** Config publique exposée par GET /regressions/config (sans secrets). */
export type VrPublicConfig = {
  compareMode: VrCompareMode;
  compareScope: VrChangedFilesScope;
  compareBase: string;
  captureConcurrency: number;
  captureMaxTestTime: number;
  compareThreshold: number;
  launcherRunInitialCompare: boolean;
  storybookUrl: string;
  deviceCount: number;
};

/** Périmètre des fichiers modifiés pour le mode incrémental. */
export type VrChangedFilesScope = "all" | "branch" | "working-tree";

/** Configuration VR résolue (fichier + env + défauts). */
export type VrConfig = {
  devices: VRDeviceConfigItem[];
  capture: {
    concurrency: number;
    maxTestTime: number;
  };
  compare: {
    mode: VrCompareMode;
    base: string;
    /** all = branche + working tree (CI) ; working-tree = dev local sur branche feature */
    scope: VrChangedFilesScope;
    includeWorkingTree: boolean;
    threshold: number;
    globalTriggers: string[];
    statsFile: string;
    manifestPath: string;
  };
  launcher: {
    runInitialCompare: boolean;
    storybookStatic: boolean;
  };
  storybook: {
    url: string;
  };
  stabilize: {
    freezeAnimations: boolean;
    waitNetworkQuietMs: number;
    waitFonts: boolean;
    burstCapture: boolean;
    burstFrames: number;
    burstIntervalMs: number;
    flakeRetryThreshold: number;
    maxStabilizeTime: number;
  };
};

/** Sections optionnelles de vr.config.cjs (fichier brut). */
export type VrConfigFile = {
  devices: VRDeviceConfigItem[];
  capture?: Partial<VrConfig["capture"]>;
  compare?: Partial<VrConfig["compare"]>;
  launcher?: Partial<VrConfig["launcher"]>;
  storybook?: Partial<VrConfig["storybook"]>;
  stabilize?: Partial<VrConfig["stabilize"]>;
};

/** Config viewport Playwright pour un device (script compare). */
export type DeviceConfig = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile?: boolean;
};

/** Logs regroupés par type (script compare). */
export type LogsType = {
  errors: string[];
  vrs: string[];
  news: string[];
};

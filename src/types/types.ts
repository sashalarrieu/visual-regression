/**
 * Types centralisés du package @setshao/visual-regression.
 * Domaine et context uniquement ; les props des composants restent dans chaque composant.
 */

// --- Domaine / config ---

/** Identifiant d'un device (clé utilisée dans l'API et les noms de fichiers). */
export type DeviceId = string;

/** Config d'affichage pour un device (label, icône, couleur dans l'UI). Passée à VisualRegressions via la prop devices. */
export type DeviceDisplayConfig = {
  name: DeviceId;
  label: string;
  icon: string;
  color: string;
};

/** Config complète d'un device : viewport (Playwright) + personnalisation affichage. Définie dans vr-devices.config.cjs. */
export type VRDeviceConfig = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  label: string;
  icon: string;
  color: string;
};

/** Style d'affichage d'un device (icône + couleur). */
export type DeviceStyle = {
  icon: string;
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

/** Cache des chemins de régressions (serveur VR). */
export type CacheData = {
  diffPaths: string[];
  newPaths: string[];
  deletedPaths: string[];
  lastUpdate: number;
};

/** Client SSE connecté au serveur VR. */
export type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController<string>;
};

/** Item chargé depuis vr-devices.config.cjs (scripts). */
export type VRDeviceConfigItem = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  label?: string;
  icon?: string;
  color?: string;
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

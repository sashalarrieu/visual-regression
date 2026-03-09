/**
 * Point d'entrée du package @setshao/visual-regression (API consommée par les projets hôtes).
 * L'app Expo standalone utilise src/index.tsx ; ce fichier est utilisé pour les imports
 * du type : import { VisualRegressions, fromVRDeviceConfig } from "@setshao/visual-regression"
 */
export { VisualRegressions } from "./VisualRegressions";
export type { VisualRegressionsProps } from "./VisualRegressions";
export type { DeviceDisplayConfig, DeviceStyle } from "./types/types";
export { createVisualRegressionActions, fromVRDeviceConfig } from "./utils";

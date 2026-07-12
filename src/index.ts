/**
 * Point d'entrée du package @setshao/visual-regression (API consommée par les projets hôtes).
 * L'app Expo standalone utilise src/index.tsx (package.json "main") ; ce fichier est utilisé pour les imports
 * du type : import { VisualRegressions, fromVRDeviceConfig } from "@setshao/visual-regression"
 */
export {
  BURST_VR_TAG,
  FORCE_VR_TAG,
  IGNORE_VR_TAG,
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
} from "./constants/constants";
export { vrPreviewDecorators, withVrReanimatedFreeze, withVrStoryPlay } from "./storybook/preview";
export type { DeviceDisplayConfig, DeviceStyle, VrStoryParameters } from "./types/types";
export { createVisualRegressionActions, fromVRDeviceConfig } from "./utils";
export * from "./utils/vr-story-play";
export { VisualRegressions } from "./VisualRegressions";
export type { VisualRegressionsProps } from "./VisualRegressions";

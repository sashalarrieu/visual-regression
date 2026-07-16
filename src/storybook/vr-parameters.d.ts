import type { VrStoryParameters } from "@setshao/visual-regression/types";

/**
 * Modèle d'augmentation TypeScript pour `parameters.vr`.
 * Copiez / adaptez ce fichier dans votre projet hôte selon le framework Storybook :
 * - `@storybook/react` → interface `ReactParameters` (stories package UI / CSF générique)
 * - `@storybook/react-webpack5` / `@storybook/nextjs-vite` / `@storybook/react-native-web-vite` → `Parameters`
 *
 * Les tags `ignore-vr` / `force-vr` restent le filtre d'éligibilité (index.json) — ne pas les mettre ici.
 */
declare module "@storybook/react-webpack5" {
  interface Parameters {
    /** Overrides SteadySnap / diff verify pour cette story (fusionnés sur vr.config.cjs). */
    vr?: VrStoryParameters;
  }
}

declare module "@storybook/react" {
  interface ReactParameters {
    /** Overrides SteadySnap / diff verify pour cette story (fusionnés sur vr.config.cjs). */
    vr?: VrStoryParameters;
  }
}

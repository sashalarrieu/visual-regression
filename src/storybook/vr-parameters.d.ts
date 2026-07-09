import type { VrStoryParameters } from "@setshao/visual-regression";

declare module "@storybook/react-webpack5" {
  interface Parameters {
    /** Overrides SteadySnap / diff verify pour cette story (fusionnés sur vr.config.cjs). */
    vr?: VrStoryParameters;
  }
}

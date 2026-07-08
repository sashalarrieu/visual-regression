import type { VrStoryParameters } from "../src/types/types";

declare module "@storybook/react-webpack5" {
  interface Parameters {
    /** Overrides SteadySnap / diff verify pour cette story (fusionnés sur vr.config.cjs). */
    vr?: VrStoryParameters;
  }
}

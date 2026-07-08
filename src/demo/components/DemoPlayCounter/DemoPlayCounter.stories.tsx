import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { clickByLabel, delay, expectText } from "../../utils/playHelpers";

import { DemoPlayCounter } from "./DemoPlayCounter";

const meta = {
  title: "Demo/Play/Counter",
  component: DemoPlayCounter,
  parameters: {
    docs: {
      description: {
        component: "Stories avec `play()` — exécuté automatiquement en capture VR avant le screenshot.",
      },
    },
  },
} satisfies Meta<typeof DemoPlayCounter>;

export default meta;

type Story = StoryObj<typeof meta>;

/** État initial (0) — sans interaction. */
export const Initial: Story = {
  args: {
    initialCount: 0,
  },
};

/** play() incrémente jusqu'à 3 — état stable attendu après les clics. */
export const AfterThreeClicks: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Trois clics sur +", async () => {
      await clickByLabel(canvasElement, "+");
      await clickByLabel(canvasElement, "+");
      await clickByLabel(canvasElement, "+");
    });

    await step("Compteur à 3", async () => {
      expectText(canvasElement, "3");
    });
  },
};

/** play() avec délais entre clics — burst espacé via parameters.vr. */
export const SlowIncrementToThree: Story = {
  parameters: {
    vr: {
      stabilize: {
        burstIntervalMs: 1000,
      },
    },
  },
  play: async ({ canvasElement, step }) => {
    await step("Clics espacés (200 ms)", async () => {
      for (let i = 0; i < 3; i++) {
        await clickByLabel(canvasElement, "+");
        await delay(200);
      }
    });

    await step("Compteur à 3", async () => {
      expectText(canvasElement, "3");
    });
  },
};

import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { clickByLabelExpect, delay, expectText } from "../../../storybook/play-helpers";

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
    await step("Trois clics sur + (chaque incrément vérifié)", async () => {
      await clickByLabelExpect(canvasElement, "+", "Compteur 1");
      await clickByLabelExpect(canvasElement, "+", "Compteur 2");
      await clickByLabelExpect(canvasElement, "+", "Compteur 3");
    });

    await step("Compteur à 3", async () => {
      expectText(canvasElement, "3");
    });
  },
};

/** play() avec délais entre clics — burst espacé via parameters.vr. */
export const SlowIncrementToThree: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Clics espacés (200ms et chaque incrément vérifié)", async () => {
      for (let i = 0; i < 3; i++) {
        await clickByLabelExpect(canvasElement, "+", `Compteur ${i + 1}`);
        await delay(200);
      }
    });

    await step("Compteur à 3", async () => {
      expectText(canvasElement, "3");
    });
  },
};

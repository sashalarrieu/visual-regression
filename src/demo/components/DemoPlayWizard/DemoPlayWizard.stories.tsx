import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { clickByLabel, expectText } from "../../utils/playHelpers";

import { DemoPlayWizard } from "./DemoPlayWizard";

const meta = {
  title: "Demo/Play/Wizard",
  component: DemoPlayWizard,
  parameters: {
    docs: {
      description: {
        component: "Enchaînement multi-étapes via `play()` — exécuté en capture VR avant screenshot.",
      },
    },
  },
} satisfies Meta<typeof DemoPlayWizard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Première étape — sans play. */
export const StepOne: Story = {};

/** play() avance jusqu'à l'étape 2. */
export const AfterOneStep: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Suivant × 1", async () => {
      await clickByLabel(canvasElement, "Suivant");
      expectText(canvasElement, "Étape 2");
    });
  },
};

/** play() termine le wizard (3 étapes). */
export const CompletedByPlay: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Étape 1 → 2", async () => {
      await clickByLabel(canvasElement, "Suivant");
      expectText(canvasElement, "Étape 2");
    });

    await step("Étape 2 → 3", async () => {
      await clickByLabel(canvasElement, "Suivant");
      expectText(canvasElement, "Terminé");
    });

    await step("État final", async () => {
      expectText(canvasElement, "Assistant complété — état final pour la VR.");
    });
  },
};

import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { clickByLabel, expectAriaLabel, expectNoAriaLabel, expectText } from "../../utils/playHelpers";

import { DemoPlayModal } from "./DemoPlayModal";

const meta = {
  title: "Demo/Play/Modal",
  component: DemoPlayModal,
  parameters: {
    docs: {
      description: {
        component: "Overlay conditionnel déclenché par `play()` — changement de layout pour la VR.",
      },
    },
  },
} satisfies Meta<typeof DemoPlayModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Modal fermée — état initial. */
export const Closed: Story = {};

/** play() ouvre la modal avant la capture. */
export const OpenedByPlay: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Ouvrir la modal", async () => {
      await clickByLabel(canvasElement, "Ouvrir le détail");
    });

    await step("Modal visible", async () => {
      expectAriaLabel(canvasElement, "Modal détail produit");
      expectText(canvasElement, "Détail produit");
    });
  },
};

/** play() ouvre puis referme — état final compact. */
export const OpenThenClose: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Ouvrir", async () => {
      await clickByLabel(canvasElement, "Ouvrir le détail");
      expectAriaLabel(canvasElement, "Modal détail produit");
    });

    await step("Fermer", async () => {
      await clickByLabel(canvasElement, "Fermer");
      expectNoAriaLabel(canvasElement, "Modal détail produit");
    });
  },
};

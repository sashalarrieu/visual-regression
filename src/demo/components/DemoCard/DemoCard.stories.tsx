import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoCard } from "./DemoCard";

const meta = {
  title: "Demo/Card",
  component: DemoCard,
} satisfies Meta<typeof DemoCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Régression visuelle",
    description: "Compare les screenshots Storybook entre devices et détecte les différences pixel par pixel.",
  },
};

export const WithBadge: Story = {
  args: {
    title: "Nouvelle story",
    description: "Cette story n'a pas encore de screenshot de référence.",
    badge: "NEW",
  },
};

export const Highlighted: Story = {
  args: {
    title: "Diff détecté",
    description: "Un changement visuel a été repéré sur iPhone 16.",
    badge: "DIFF",
    highlighted: true,
  },
};

import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoButton, DemoButtonGroup } from "./components/DemoButton";

const meta = {
  title: "Demo/Button",
  component: DemoButton,
  args: {
    label: "Label",
    variant: "primary",
  },
} satisfies Meta<typeof DemoButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    label: "Valider",
    variant: "primary",
  },
};

export const Secondary: Story = {
  args: {
    label: "Annuler",
    variant: "secondary",
  },
};

export const Disabled: Story = {
  args: {
    label: "Indisponible",
    disabled: true,
  },
};

export const AllVariants: Story = {
  render: () => <DemoButtonGroup />,
};

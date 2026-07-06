import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoStaticBox } from "./DemoStaticBox";

const meta = {
  title: "Demo/Animation/Static",
  component: DemoStaticBox,
  parameters: {
    docs: {
      description: {
        component: "Baseline sans animation — référence pour SteadySnap / captures stables.",
      },
    },
  },
} satisfies Meta<typeof DemoStaticBox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

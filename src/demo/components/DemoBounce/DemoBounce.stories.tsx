import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoBounce } from "./DemoBounce";

const meta = {
  title: "Demo/Animation/Bounce",
  component: DemoBounce,
  parameters: {
    docs: {
      description: {
        component: "Animation simple — scale bounce (800 ms).",
      },
    },
  },
} satisfies Meta<typeof DemoBounce>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

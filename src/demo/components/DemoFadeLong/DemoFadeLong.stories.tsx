import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoFadeLong } from "./DemoFadeLong";

const meta = {
  title: "Demo/Animation/FadeLong",
  component: DemoFadeLong,
  parameters: {
    docs: {
      description: {
        component: "Animation simple longue (2 s) — sensible au timing de capture.",
      },
    },
  },
} satisfies Meta<typeof DemoFadeLong>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

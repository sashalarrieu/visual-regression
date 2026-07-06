import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoFadeShort } from "./DemoFadeShort";

const meta = {
  title: "Demo/Animation/FadeShort",
  component: DemoFadeShort,
  parameters: {
    docs: {
      description: {
        component: "Animation simple courte (300 ms) — opacité.",
      },
    },
  },
} satisfies Meta<typeof DemoFadeShort>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

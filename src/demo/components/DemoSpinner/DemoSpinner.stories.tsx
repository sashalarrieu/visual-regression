import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoSpinner } from "./DemoSpinner";

const meta = {
  title: "Demo/Animation/SpinnerComplex",
  component: DemoSpinner,
  parameters: {
    docs: {
      description: {
        component: "Animation complexe — anneau rotatif + 3 orbites + pulsation d'opacité.",
      },
    },
  },
} satisfies Meta<typeof DemoSpinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoFadeLong } from "../DemoFadeLong/DemoFadeLong";
import { DemoFadeShort } from "../DemoFadeShort/DemoFadeShort";
import { DemoSpinner } from "../DemoSpinner/DemoSpinner";

import { DemoNestedPanel } from "./DemoNestedPanel";

const meta = {
  title: "Demo/Scenarios/NestedPanel",
  component: DemoNestedPanel,
  parameters: {
    docs: {
      description: {
        component:
          "Scénarios imbriqués : plusieurs composants atomiques composés. Utile pour tester TurboSnap (deps transitives).",
      },
    },
  },
} satisfies Meta<typeof DemoNestedPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Header + Card + boutons, aucune animation. */
export const StaticNested: Story = {
  render: () => <DemoNestedPanel variant="static" />,
};

/** Panneau statique avec enfant animé court (fade 300 ms). */
export const NestedWithFadeShort: Story = {
  render: () => (
    <DemoNestedPanel
      animatedSlot={<DemoFadeShort />}
      variant="with-animation"
    />
  ),
};

/** Panneau statique avec enfant animé long (fade 2 s). */
export const NestedWithFadeLong: Story = {
  render: () => (
    <DemoNestedPanel
      animatedSlot={<DemoFadeLong />}
      variant="with-animation"
    />
  ),
};

/** Panneau statique avec spinner complexe. */
export const NestedWithSpinner: Story = {
  render: () => (
    <DemoNestedPanel
      animatedSlot={<DemoSpinner />}
      variant="with-animation"
    />
  ),
};

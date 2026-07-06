import type { Meta, StoryObj } from "@storybook/react-webpack5";

import { DemoProfileHeader } from "./DemoProfileHeader";

const meta = {
  title: "Demo/ProfileHeader",
  component: DemoProfileHeader,
} satisfies Meta<typeof DemoProfileHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Online: Story = {
  args: {
    name: "Alex Martin",
    role: "Designer UI",
    status: "online",
  },
};

export const Busy: Story = {
  args: {
    name: "Camille Dupont",
    role: "Développeuse front",
    status: "busy",
  },
};

export const Offline: Story = {
  args: {
    name: "Jordan Lee",
    role: "QA Engineer",
    status: "offline",
  },
};

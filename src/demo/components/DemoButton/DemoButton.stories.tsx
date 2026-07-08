import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { StyleSheet, View } from "react-native";

import { DemoButton } from "./DemoButton";

const meta = {
  title: "Demo/Button",
  component: DemoButton,
  args: {
    label: "Primary",
    variant: "primary",
  },
} satisfies Meta<typeof DemoButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    label: "Primary",
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
  render: () => (
    <View style={styles.group}>
      <DemoButton
        label="Primary"
        variant="primary"
      />
      <DemoButton
        label="Secondary"
        variant="secondary"
      />
      <DemoButton
        label="Danger"
        variant="danger"
      />
    </View>
  ),
};

const styles = StyleSheet.create({
  group: {
    alignItems: "center",
    gap: 12,
  },
});

import { Pressable, StyleSheet, Text, View } from "react-native";

type DemoButtonProps = {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onPress?: () => void;
};

const variantStyles = {
  primary: { backgroundColor: "#2563eb", color: "#ffffff" },
  secondary: { backgroundColor: "#e5e7eb", color: "#1f2937" },
  danger: { backgroundColor: "#dc2626", color: "#ffffff" },
} as const;

export const DemoButton = ({ label, variant = "primary", disabled = false, onPress }: DemoButtonProps) => {
  const colors = variantStyles[variant];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.backgroundColor, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: colors.color }]}>{label}</Text>
    </Pressable>
  );
};

export const DemoButtonGroup = () => (
  <View style={styles.group}>
    <DemoButton
      label="Test"
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
);

const styles = StyleSheet.create({
  button: {
    borderRadius: 10,
    minWidth: 140,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  group: {
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});

import React from "react";
import { View, Text, Switch } from "react-native";
import { spacing } from "../theme";

export type ToggleFieldProps = {
  title: string;
  value: boolean;
  onChange: (value: boolean | undefined) => void;
  disabled?: boolean;
};

export const ToggleField: React.FC<ToggleFieldProps> = ({ title, value, onChange, disabled }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.s }}>
    <Text style={{ fontSize: 14 }}>{title}</Text>
    <Switch value={value} onValueChange={onChange} disabled={disabled} />
  </View>
);

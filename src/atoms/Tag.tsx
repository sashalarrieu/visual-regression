import React from "react";
import { Text, View } from "react-native";

import { colors, spacing, type ColorKey } from "@themes/theme";

export type TagProps = {
  label: { text: string };
  color: ColorKey;
};

export const Tag: React.FC<TagProps> = ({ label, color }) => (
  <View style={{ backgroundColor: colors[color], paddingHorizontal: spacing.s, paddingVertical: 2, borderRadius: 4 }}>
    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{label.text}</Text>
  </View>
);

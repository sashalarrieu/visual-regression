import React from "react";
import { View, Text } from "react-native";
import { colors, type ColorKey } from "../theme";
import { spacing } from "../theme";

export type TagProps = {
  label: { text: string };
  color: ColorKey;
};

export const Tag: React.FC<TagProps> = ({ label, color }) => (
  <View style={{ backgroundColor: colors[color], paddingHorizontal: spacing.s, paddingVertical: 2, borderRadius: 4 }}>
    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{label.text}</Text>
  </View>
);

import React from "react";
import { View } from "react-native";

import { colors } from "../themes/theme";

export type DividerProps = {
  orientation?: "vertical" | "horizontal";
};

export const Divider: React.FC<DividerProps> = ({ orientation = "horizontal" }) => (
  <View
    style={{
      backgroundColor: colors.newTheme_border,
      ...(orientation === "vertical" ? { width: 1, alignSelf: "stretch" } : { height: 1, width: "100%" }),
    }}
  />
);

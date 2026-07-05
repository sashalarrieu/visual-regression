import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import type { StyleProp, TextStyle } from "react-native";

import type { MaterialIconName } from "@app-types/types";
import { colors, spacing, type ColorKey } from "@themes/theme";

const sizeMap = { s: 14, m: 18, l: 22 };

export type IconProps = {
  name: MaterialIconName;
  fill?: ColorKey;
  size?: "s" | "m" | "l";
  style?: StyleProp<TextStyle>;
};

export const Icon: React.FC<IconProps> = ({ name, fill = "newTheme_textOnSurface", size = "m", style }) => (
  <MaterialIcons
    name={name}
    size={sizeMap[size]}
    color={colors[fill]}
    style={[{ marginRight: spacing.s }, style]}
  />
);

import React from "react";
import { Text, type TextStyle } from "react-native";

import { colors, spacing, type ColorKey } from "@themes/theme";

const iconMap: Record<string, string> = {
  mobile: "📱",
  "tablet-portrait": "📱",
  "tablet-landscape": "🖥",
  laptop: "💻",
  hint: "?",
};

const sizeMap = { s: 12, m: 16, l: 20 };

export type IconProps = {
  name: string;
  fill?: ColorKey;
  size?: "s" | "m" | "l";
};

export const Icon: React.FC<IconProps> = ({ name, fill = "newTheme_textOnSurface", size = "m" }) => {
  const sym = iconMap[name] ?? name;
  const style: TextStyle = {
    fontSize: sizeMap[size],
    color: colors[fill],
    marginRight: spacing.s,
  };
  return <Text style={style}>{sym}</Text>;
};

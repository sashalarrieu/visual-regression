import React from "react";
import { Text, View } from "react-native";

import { colors, type ColorKey } from "../themes/theme";

export type BulletProps = {
  value: number;
  color: ColorKey;
};

export const Bullet: React.FC<BulletProps> = ({ value, color }) => {
  const textColor = color === "newTheme_background" ? colors.newTheme_textOnSurface : colors.newTheme_textOnPrimary;

  return (
    <View
      style={{
        borderRadius: 4,
        backgroundColor: colors[color],
        paddingHorizontal: 4,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 8, color: textColor }}>{value}</Text>
    </View>
  );
};

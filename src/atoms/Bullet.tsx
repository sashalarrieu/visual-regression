import React from "react";
import { Text, View } from "react-native";

import { colors, type ColorKey } from "../themes/theme";

export type BulletProps = {
  value: number;
  color: ColorKey;
  textColor: ColorKey;
};

export const Bullet: React.FC<BulletProps> = ({ value, color, textColor }) => (
  <View
    style={{
      paddingVertical: 2,
      paddingHorizontal: 4,
      borderRadius: 4,
      backgroundColor: colors[color],
    }}
  >
    <Text style={{ fontSize: 10, color: colors[textColor] }}>{value}</Text>
  </View>
);

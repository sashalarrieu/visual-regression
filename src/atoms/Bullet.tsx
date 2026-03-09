import React from "react";
import { Text, View } from "react-native";

import { colors, type ColorKey } from "@themes/theme";

export type BulletProps = {
  value: number;
  color: ColorKey;
};

export const Bullet: React.FC<BulletProps> = ({ value, color }) => (
  <View style={{ flexDirection: "row", alignItems: "center", marginRight: 8 }}>
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors[color],
        marginRight: 4,
      }}
    />
    <Text style={{ fontSize: 12, color: colors.newTheme_textLegend }}>{value}</Text>
  </View>
);

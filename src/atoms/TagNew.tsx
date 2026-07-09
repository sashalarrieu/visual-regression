import React from "react";
import { Text, View } from "react-native";

import { colors, spacing } from "../themes/theme";

export const TagNew: React.FC = () => (
  <View
    style={{
      backgroundColor: colors.newTheme_primary80,
      paddingHorizontal: spacing.s,
      paddingVertical: 2,
      borderRadius: 4,
    }}
  >
    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>NEW</Text>
  </View>
);

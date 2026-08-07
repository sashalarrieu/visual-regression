import React from "react";
import { TextInput, View } from "react-native";

import { colors, spacing } from "../themes/theme";

import { Icon } from "./Icon";

export type SearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

export const SearchField: React.FC<SearchFieldProps> = ({ value, onChangeText, placeholder = "Rechercher…" }) => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.newTheme_surface,
      borderWidth: 1,
      borderColor: colors.newTheme_border,
      borderRadius: 6,
      paddingHorizontal: spacing.s,
      paddingVertical: spacing.xs,
      gap: spacing.xs,
    }}
  >
    <Icon
      name="search"
      fill="newTheme_textLegend"
      size="s"
      style={{ marginRight: 0 }}
    />
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.newTheme_textLegend}
      style={{
        flex: 1,
        fontSize: 14,
        color: colors.newTheme_textOnSurface,
        paddingVertical: spacing.xs,
      }}
      autoCorrect={false}
      autoCapitalize="none"
      clearButtonMode="while-editing"
    />
  </View>
);

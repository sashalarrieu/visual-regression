import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View, type DimensionValue } from "react-native";

import { colors, spacing, type ColorKey } from "../themes/theme";
import type { MaterialIconName } from "../types/types";

import { Icon } from "./Icon";

export type ButtonProps = {
  label?: string;
  icon?: { name: MaterialIconName };
  leftIcon?: { name: MaterialIconName; fill?: ColorKey };
  rightIcon?: { name: MaterialIconName; fill?: ColorKey };
  color?: "primary" | "danger" | "base";
  onPress: () => void;
  loading?: boolean;
  width?: DimensionValue;
  flex?: number;
  justifyContent?: "space-between" | "center";
  number?: number;
  title?: { text: string };
  disabled?: boolean;
  accessibilityLabel?: string;
};

const colorBg: Record<string, string> = {
  primary: colors.newTheme_primary,
  danger: colors.newTheme_danger,
  base: colors.newTheme_surface,
};

export const Button: React.FC<ButtonProps> = ({
  label,
  icon,
  leftIcon,
  rightIcon,
  color = "primary",
  onPress,
  loading,
  width,
  flex,
  justifyContent,
  number,
  title,
  disabled,
  accessibilityLabel,
}) => {
  const bg = colorBg[color] ?? colorBg.primary;
  const textColor = color === "base" ? colors.newTheme_textOnSurface : colors.newTheme_textOnPrimary;
  const defaultIconFill: ColorKey = color === "base" ? "newTheme_textOnSurface" : "newTheme_textOnPrimary";

  const renderIcon = (cfg: { name: MaterialIconName; fill?: ColorKey } | undefined) => {
    if (!cfg) return null;
    return (
      <Icon
        name={cfg.name}
        fill={cfg.fill ?? defaultIconFill}
        size="m"
        style={{ marginHorizontal: 4, marginRight: 4 }}
      />
    );
  };

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: justifyContent ?? "center",
        gap: spacing.xs,
      }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={textColor}
        />
      ) : (
        <>
          {renderIcon(leftIcon)}
          {(label ?? title?.text) && (
            <Text style={{ color: textColor, fontWeight: "600" }}>{label ?? title?.text}</Text>
          )}
          {number !== undefined && number > 0 && <Text style={{ color: textColor, fontSize: 12 }}>({number})</Text>}
          {renderIcon(rightIcon)}
          {!label && !title?.text && icon && renderIcon(icon)}
        </>
      )}
    </View>
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={accessibilityLabel}
      style={{
        backgroundColor: bg,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.s,
        borderRadius: 8,
        minWidth: width,
        flex: flex,
        opacity: disabled || loading ? 0.3 : 1,
      }}
    >
      {content}
    </TouchableOpacity>
  );
};

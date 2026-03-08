import React from "react";
import { TouchableOpacity, Text, ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, spacing, type ColorKey } from "../theme";

export type ButtonProps = {
  label?: string;
  icon?: { name: string };
  leftIcon?: { name: string; fill?: ColorKey };
  rightIcon?: { name: string; fill?: ColorKey };
  color?: "primary" | "danger" | "base";
  onPress: () => void;
  loading?: boolean;
  width?: number;
  flex?: number;
  justifyContent?: "space-between" | "center";
  number?: number;
  title?: { text: string };
  disabled?: boolean;
};

const iconMap: Record<string, string> = {
  "chevron-left": "←",
  "chevron-right": "→",
  clone: "⎘",
  "arrows-retweet": "↻",
  "clock-arrow-rotate": "🕐",
  "arrows-revert": "↺",
  "triangle-exclamation": "⚠",
  plus: "+",
  mobile: "📱",
  "tablet-portrait": "📱",
  "tablet-landscape": "🖥",
  laptop: "💻",
  hint: "?",
  "squares-group": "⊞",
  trash: "⋮",
};

const colorBg: Record<string, string> = {
  primary: colors.newTheme_primary,
  danger: colors.newTheme_danger,
  base: colors.newTheme_base10,
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
}) => {
  const bg = colorBg[color] ?? colorBg.primary;
  const textColor = color === "base" ? colors.newTheme_textOnSurface : colors.newTheme_textOnPrimary;

  const renderIcon = (cfg: { name: string; fill?: ColorKey } | undefined) => {
    if (!cfg) return null;
    const sym = iconMap[cfg.name] ?? cfg.name;
    return <Text style={{ color: cfg.fill ? colors[cfg.fill] : textColor, marginHorizontal: 4 }}>{sym}</Text>;
  };

  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: justifyContent ?? "center", gap: spacing.xs }}>
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {renderIcon(leftIcon)}
          {(label ?? title?.text) && (
            <Text style={{ color: textColor, fontWeight: "600" }}>{label ?? title?.text}</Text>
          )}
          {number !== undefined && number > 0 && (
            <Text style={{ color: textColor, fontSize: 12 }}>({number})</Text>
          )}
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
      style={{
        backgroundColor: bg,
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.m,
        borderRadius: 8,
        minWidth: width,
        flex: flex,
      }}
    >
      {content}
    </TouchableOpacity>
  );
};

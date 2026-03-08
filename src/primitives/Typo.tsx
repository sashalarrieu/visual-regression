import React from "react";
import { Text, type TextProps, type StyleProp, type TextStyle } from "react-native";
import { colors, type ColorKey } from "../theme";

const variantStyles: Record<string, TextStyle> = {
  h2_semiBold: { fontSize: 20, fontWeight: "600" },
  paragraphe_regular: { fontSize: 14 },
  paragraphe_semiBold: { fontSize: 14, fontWeight: "600" },
  paragraphe_extraBold: { fontSize: 14, fontWeight: "800" },
  legend_regular: { fontSize: 12, color: colors.newTheme_textLegend },
};

export type TypoProps = TextProps & {
  variant?: keyof typeof variantStyles;
  color?: ColorKey;
  textTransform?: "uppercase" | "none";
  textAlign?: "center" | "left" | "right";
  numberOfLines?: number;
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
};

export const Typo: React.FC<TypoProps> = ({
  variant = "paragraphe_regular",
  color,
  textTransform,
  textAlign,
  numberOfLines,
  children,
  style,
  ...rest
}) => {
  const baseStyle = variantStyles[variant] ?? variantStyles.paragraphe_regular;
  const composed: TextStyle = {
    ...baseStyle,
    ...(color && { color: colors[color] }),
    ...(textTransform && { textTransform }),
    ...(textAlign && { textAlign }),
  };
  return (
    <Text numberOfLines={numberOfLines} style={[composed, style]} {...rest}>
      {children}
    </Text>
  );
};

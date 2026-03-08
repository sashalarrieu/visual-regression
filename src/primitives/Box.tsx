import React from "react";
import { View, type ViewProps, type StyleProp, type ViewStyle } from "react-native";
import { spacing, colors, type SpacingKey, type ColorKey } from "../theme";

type Spacing = SpacingKey | number;

const resolveSpacing = (s: Spacing): number => (typeof s === "string" ? spacing[s] ?? 0 : s);

export type BoxProps = ViewProps & {
  flex?: number;
  flexDirection?: "row" | "column";
  flexShrink?: number;
  gap?: Spacing;
  p?: Spacing;
  px?: Spacing;
  py?: Spacing;
  pb?: Spacing;
  width?: number | string;
  height?: number | string;
  minHeight?: number;
  alignItems?: "center" | "flex-start" | "flex-end" | "stretch";
  justifyContent?: "center" | "flex-start" | "flex-end" | "space-between";
  backgroundColor?: ColorKey;
  borderRadius?: "base" | number;
  borderWidth?: number;
  borderColor?: ColorKey;
  position?: "absolute" | "relative";
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  overflow?: "hidden" | "visible";
  zIndex?: number;
  style?: StyleProp<ViewStyle>;
};

export const Box: React.FC<BoxProps> = ({
  flex,
  flexDirection,
  flexShrink,
  gap,
  p,
  px,
  py,
  pb,
  width,
  height,
  minHeight,
  alignItems,
  justifyContent,
  backgroundColor,
  borderRadius,
  borderWidth,
  borderColor,
  position,
  top,
  left,
  right,
  bottom,
  overflow,
  zIndex,
  style,
  children,
  ...rest
}) => {
  const resolvedGap = gap !== undefined ? resolveSpacing(gap) : undefined;
  const baseRadius = borderRadius === "base" ? 8 : typeof borderRadius === "number" ? borderRadius : undefined;

  const composedStyle: ViewStyle = {
    ...(flex !== undefined && { flex }),
    ...(flexDirection && { flexDirection }),
    ...(flexShrink !== undefined && { flexShrink }),
    ...(resolvedGap !== undefined && { gap: resolvedGap }),
    ...(p !== undefined && { padding: resolveSpacing(p) }),
    ...(px !== undefined && { paddingHorizontal: resolveSpacing(px) }),
    ...(py !== undefined && { paddingVertical: resolveSpacing(py) }),
    ...(pb !== undefined && { paddingBottom: resolveSpacing(pb) }),
    ...(width !== undefined && { width: typeof width === "string" ? width : width }),
    ...(height !== undefined && { height: typeof height === "string" ? height : height }),
    ...(minHeight !== undefined && { minHeight }),
    ...(alignItems && { alignItems }),
    ...(justifyContent && { justifyContent }),
    ...(backgroundColor && { backgroundColor: colors[backgroundColor] }),
    ...(baseRadius !== undefined && { borderRadius: baseRadius }),
    ...(borderWidth !== undefined && { borderWidth }),
    ...(borderColor && { borderColor: colors[borderColor] }),
    ...(position && { position }),
    ...(top !== undefined && { top }),
    ...(left !== undefined && { left }),
    ...(right !== undefined && { right }),
    ...(bottom !== undefined && { bottom }),
    ...(overflow && { overflow }),
    ...(zIndex !== undefined && { zIndex }),
  };

  return (
    <View style={[composedStyle, style as ViewStyle]} {...rest}>
      {children}
    </View>
  );
};

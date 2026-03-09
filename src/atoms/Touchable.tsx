import React from "react";
import { TouchableOpacity, type TouchableOpacityProps } from "react-native";

export type TouchableProps = TouchableOpacityProps & {
  notPressable?: boolean;
};

export const Touchable: React.FC<TouchableProps> = ({ notPressable, onPress, children, ...rest }) => (
  <TouchableOpacity
    onPress={notPressable ? undefined : onPress}
    activeOpacity={0.7}
    {...rest}
  >
    {children}
  </TouchableOpacity>
);

import React from "react";
import { View } from "react-native";

import { Typo } from "@atoms/Typo";
import { spacing } from "@themes/theme";

export type EndOfListProps = {
  emptyText: string;
  nbItem?: number;
};

export const EndOfList: React.FC<EndOfListProps> = ({ emptyText, nbItem }) => (
  <View style={{ padding: spacing.l, alignItems: "center" }}>
    <Typo
      variant="paragraphe_regular"
      color="newTheme_textLegend"
    >
      {nbItem !== undefined && nbItem === 0 ? emptyText : emptyText}
    </Typo>
  </View>
);

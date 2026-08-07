import React, { useState } from "react";
import { TouchableOpacity, View } from "react-native";

import type { SelectionState } from "../utils/tree-selection";

import { Box } from "./Box";
import { Icon } from "./Icon";
import { Typo } from "./Typo";

const checkboxIconName = (state: SelectionState) => {
  if (state === "all") return "check-box" as const;
  if (state === "partial") return "indeterminate-check-box" as const;
  return "check-box-outline-blank" as const;
};

export type AccordionProps = {
  label: { text: string };
  tags?: React.ReactNode[];
  defaultOpened?: boolean;
  style?: { paddingBottom?: number };
  children: React.ReactNode;
  /** Affiche une checkbox et sépare expand (chevron) de la sélection (label + checkbox). */
  selectionMode?: boolean;
  selectionState?: SelectionState;
  onToggleSelect?: () => void;
};

export const Accordion: React.FC<AccordionProps> = ({
  label,
  tags,
  defaultOpened = true,
  style,
  children,
  selectionMode = false,
  selectionState = "none",
  onToggleSelect,
}) => {
  const [opened, setOpened] = useState(defaultOpened);
  const toggleOpened = () => setOpened(o => !o);

  const headerStyle = { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 8 };
  const tagsNode = tags ? <View style={{ flexDirection: "row", marginLeft: 8, gap: 4 }}>{tags}</View> : null;

  if (!selectionMode) {
    return (
      <View>
        <TouchableOpacity
          onPress={toggleOpened}
          style={headerStyle}
        >
          <Icon
            name={opened ? "expand-more" : "chevron-right"}
            size="s"
            style={{ marginRight: 4 }}
          />
          <Typo variant="paragraphe_semiBold">{label.text}</Typo>
          {tagsNode}
        </TouchableOpacity>
        {opened && <Box style={style}>{children}</Box>}
      </View>
    );
  }

  return (
    <View>
      <View style={headerStyle}>
        <TouchableOpacity
          onPress={onToggleSelect}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: selectionState === "partial" ? "mixed" : selectionState === "all",
          }}
        >
          <Icon
            name={checkboxIconName(selectionState)}
            size="s"
            style={{ marginRight: 4 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleOpened}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={opened ? "Réduire" : "Développer"}
        >
          <Icon
            name={opened ? "expand-more" : "chevron-right"}
            size="s"
            style={{ marginRight: 4 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onToggleSelect}
          style={{ flexShrink: 1 }}
          accessibilityRole="button"
        >
          <Typo variant="paragraphe_semiBold">{label.text}</Typo>
        </TouchableOpacity>
        {tagsNode}
      </View>
      {opened && <Box style={style}>{children}</Box>}
    </View>
  );
};

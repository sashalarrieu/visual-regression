import React, { useState } from "react";
import { TouchableOpacity, View } from "react-native";

import { Box } from "@atoms/Box";
import { Icon } from "@atoms/Icon";
import { Typo } from "@atoms/Typo";

export type AccordionProps = {
  label: { text: string };
  tags?: React.ReactNode[];
  defaultOpened?: boolean;
  style?: { paddingBottom?: number };
  children: React.ReactNode;
};

export const Accordion: React.FC<AccordionProps> = ({ label, tags, defaultOpened = true, style, children }) => {
  const [opened, setOpened] = useState(defaultOpened);
  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpened(o => !o)}
        style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}
      >
        <Icon
          name={opened ? "expand-more" : "chevron-right"}
          size="s"
          style={{ marginRight: 4 }}
        />
        <Typo variant="paragraphe_semiBold">{label.text}</Typo>
        {tags && <View style={{ flexDirection: "row", marginLeft: 8, gap: 4 }}>{tags}</View>}
      </TouchableOpacity>
      {opened && <Box style={style}>{children}</Box>}
    </View>
  );
};

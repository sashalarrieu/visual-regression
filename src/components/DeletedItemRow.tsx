import React from "react";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { Picture } from "../atoms/Picture";
import { Tag } from "../atoms/Tag";
import { TagNew } from "../atoms/TagNew";
import { Touchable } from "../atoms/Touchable";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import type { DeletedItem } from "../types/types";

import { ScreenshotDetails } from "./ScreenshotDetails";

export type DeletedItemRowProps = {
  item: DeletedItem;
  onRestore: (fullPath: string, isDiff: boolean) => void;
  selected?: boolean;
  onSelect?: (fullPath: string) => void;
  disabled?: boolean;
};

export const DeletedItemRow: React.FC<DeletedItemRowProps> = ({
  item,
  onRestore,
  selected = false,
  onSelect,
  disabled = false,
}) => {
  useDeviceConfig();
  const handlePress = () => {
    if (!disabled && onSelect) onSelect(item.fullPath);
  };
  const handleRestorePress = () => onRestore(item.fullPath, item.isDiff);

  return (
    <Box
      flex={1}
      backgroundColor={selected ? "newTheme_primary10" : "newTheme_surface"}
      borderColor={selected ? "newTheme_primary" : "newTheme_background"}
      borderWidth={1}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap="m"
      p="m"
      borderRadius="base"
    >
      <Touchable
        onPress={handlePress}
        notPressable={!onSelect || disabled}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 16 }}
      >
        <Picture
          source={item.imageUrl ? { uri: item.imageUrl } : undefined}
          size="xl"
          contentFit="contain"
        />
        <ScreenshotDetails
          deviceName={item.deviceName}
          storyId={item.storyId || item.label}
          countPixelDiff={item.isDiff ? item.countPixelDiff : undefined}
        />
      </Touchable>
      <Box
        flexShrink={1}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap="m"
      >
        {item.isDiff ? (
          <Tag
            label={{ text: "DIFF" }}
            color="newTheme_danger"
          />
        ) : (
          <TagNew />
        )}
        <Button
          onPress={handleRestorePress}
          icon={{ name: onSelect ? "sync" : "replay" }}
          color="base"
          disabled={disabled}
        />
      </Box>
    </Box>
  );
};

import React from "react";
import { getDeviceStyle, type DeviceName } from "../utils/VisualRegression";
import { ScreenshotDetails } from "./ScreenshotDetails";
import { Box } from "../primitives/Box";
import { Button } from "../primitives/Button";
import { Picture } from "../primitives/Picture";
import { Tag } from "../primitives/Tag";
import { TagNew } from "../primitives/TagNew";
import { Touchable } from "../primitives/Touchable";

export type DeletedItem = {
  isDiff: boolean;
  fullPath: string;
  imagePath: string;
  imageUrl?: string;
  folders: string[];
  fileName: string;
  label: string;
  deviceName?: DeviceName;
  storyId?: string;
  countPixelDiff?: number | null;
};

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
  const handlePress = () => {
    if (!disabled && onSelect) onSelect(item.fullPath);
  };
  const handleRestorePress = () => onRestore(item.fullPath, item.isDiff);

  return (
    <Touchable onPress={handlePress} notPressable={!onSelect || disabled}>
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
        <Picture source={item.imageUrl ? { uri: item.imageUrl } : undefined} size="xl" contentFit="contain" />
        <ScreenshotDetails
          deviceName={item.deviceName}
          storyId={item.storyId || item.label}
          countPixelDiff={item.isDiff ? item.countPixelDiff : undefined}
          showHeatmap={item.isDiff && item.countPixelDiff != null}
          getDeviceStyle={getDeviceStyle}
        />
        <Box flexShrink={1} flexDirection="row" alignItems="center" justifyContent="space-between" gap="m">
          {item.isDiff ? (
            <Tag label={{ text: "DIFF" }} color="newTheme_danger" />
          ) : (
            <TagNew />
          )}
          <Button
            onPress={handleRestorePress}
            icon={{ name: onSelect ? "arrows-retweet" : "arrows-revert" }}
            color="base"
          />
        </Box>
      </Box>
    </Touchable>
  );
};

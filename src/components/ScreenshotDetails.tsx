import React from "react";
import { DeviceName, formatStoryIdForDisplay, getDeviceDisplayName } from "../utils/VisualRegression";
import type { DeviceStyle } from "../utils/VisualRegression";
import { Box } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Typo } from "../primitives/Typo";

export type ScreenshotDetailsProps = {
  deviceName?: DeviceName;
  storyId?: string;
  countPixelDiff?: number | null;
  showHeatmap?: boolean;
  bold?: boolean;
  getDeviceStyle: (deviceName?: DeviceName) => DeviceStyle;
};

export const ScreenshotDetails: React.FC<ScreenshotDetailsProps> = ({
  deviceName,
  storyId,
  countPixelDiff,
  showHeatmap,
  bold,
  getDeviceStyle,
}) => {
  const deviceStyle = getDeviceStyle(deviceName);
  const deviceDisplayName = deviceName ? getDeviceDisplayName(deviceName) : undefined;
  const storyDisplayName = storyId ? formatStoryIdForDisplay(storyId) : undefined;
  const variant = bold ? "paragraphe_extraBold" : "paragraphe_regular";
  return (
    <Box flex={1} alignItems="center" justifyContent="center">
      {deviceDisplayName && (
        <Box flexDirection="row" alignItems="center" gap="s">
          <Icon name={deviceStyle.icon} fill={deviceStyle.color as any} size="m" />
          <Typo variant={variant as any}>{deviceDisplayName}</Typo>
        </Box>
      )}
      <Typo variant={variant as any}>{storyDisplayName}</Typo>
      {showHeatmap && countPixelDiff !== undefined && countPixelDiff !== null && (
        <Typo variant="paragraphe_regular" color="newTheme_danger">
          {countPixelDiff ?? "- "}px
        </Typo>
      )}
    </Box>
  );
};

import React from "react";

import { Box } from "../atoms/Box";
import { Icon } from "../atoms/Icon";
import { Typo, type TypoProps } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import type { ColorKey } from "../themes/theme";
import { formatStoryIdForDisplay } from "../utils";

export type ScreenshotDetailsProps = {
  deviceName?: string;
  storyId?: string;
  countPixelDiff?: number | null;
  showHeatmap?: boolean;
  bold?: boolean;
};

export const ScreenshotDetails: React.FC<ScreenshotDetailsProps> = ({
  deviceName,
  storyId,
  countPixelDiff,
  showHeatmap,
  bold,
}) => {
  const { getDeviceStyle, getDeviceDisplayName } = useDeviceConfig();
  const deviceStyle = getDeviceStyle(deviceName);
  const deviceDisplayName = deviceName ? getDeviceDisplayName(deviceName) : undefined;
  const storyDisplayName = storyId ? formatStoryIdForDisplay(storyId) : undefined;
  const variant = bold ? "paragraphe_extraBold" : "paragraphe_regular";
  return (
    <Box
      flex={1}
      alignItems="center"
      justifyContent="center"
    >
      {deviceDisplayName && (
        <Box
          flexDirection="row"
          alignItems="center"
          gap="s"
        >
          <Icon
            name={deviceStyle.icon}
            fill={deviceStyle.color as ColorKey}
            size="m"
          />
          <Typo variant={variant as TypoProps["variant"]}>{deviceDisplayName}</Typo>
        </Box>
      )}
      <Typo variant={variant as TypoProps["variant"]}>{storyDisplayName}</Typo>
      {countPixelDiff !== undefined && countPixelDiff !== null && (
        <Typo
          variant="paragraphe_regular"
          color="newTheme_danger"
        >
          {countPixelDiff ?? "- "}px
        </Typo>
      )}
    </Box>
  );
};

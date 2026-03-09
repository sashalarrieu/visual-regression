import React, { useMemo } from "react";
import { ActivityIndicator, Image } from "react-native";

import type { StoryScreenshotsPath } from "@app-types/types";
import { Box } from "@atoms/Box";
import { Typo } from "@atoms/Typo";
import { AnimatedLoader } from "@components/AnimatedLoader";
import { DraggableImageCompare } from "@components/DraggableImageCompare";
import { ScreenshotDetails } from "@components/ScreenshotDetails";
import { useDeviceConfig } from "@providers/DeviceConfigProvider";
import { colors } from "@themes/theme";
import { addCacheBusting } from "@utils";

export type ContentPanelProps = {
  tree: unknown;
  treeType: "new" | "diff";
  showHeatmap: boolean;
  imageUrls: StoryScreenshotsPath;
  isRegenerating?: boolean;
  imageCacheKey?: number;
  storyId?: string;
  deviceName?: string;
};

export const ContentPanel: React.FC<ContentPanelProps> = ({
  tree,
  treeType,
  showHeatmap,
  imageUrls,
  isRegenerating = false,
  imageCacheKey,
  storyId,
  deviceName,
}) => {
  const { getDeviceStyle } = useDeviceConfig();
  const cachedImageUrls = useMemo(
    () => ({
      original: addCacheBusting(imageUrls.original, imageCacheKey),
      temp: addCacheBusting(imageUrls.temp, imageCacheKey),
      diff: addCacheBusting(imageUrls.diff, imageCacheKey),
      new: addCacheBusting(imageUrls.new, imageCacheKey),
    }),
    [imageUrls, imageCacheKey],
  );

  if (!tree) {
    return (
      <Box
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="m"
        backgroundColor="newTheme_neutral"
        borderRadius="base"
        borderWidth={1}
        borderColor="newTheme_border"
      >
        <AnimatedLoader />
        <Typo variant="h2_semiBold">Aucune regression détectée, ni nouvelle screenshot</Typo>
      </Box>
    );
  }

  if (isRegenerating) {
    const deviceColor = deviceName
      ? colors[getDeviceStyle(deviceName).color as keyof typeof colors]
      : colors.newTheme_fantasy;
    return (
      <Box
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="m"
        backgroundColor="newTheme_neutral"
        borderRadius="base"
        borderWidth={1}
        borderColor="newTheme_border"
      >
        <AnimatedLoader />
        <ActivityIndicator
          size="large"
          color={deviceColor}
        />
        <Box gap="s">
          <Typo variant="paragraphe_regular">Régénération de l'image en cours...</Typo>
          <ScreenshotDetails
            deviceName={deviceName}
            storyId={storyId}
            bold
          />
        </Box>
      </Box>
    );
  }

  return (
    <>
      {treeType === "new" && cachedImageUrls.new && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <Box
            flex={1}
            alignItems="center"
            justifyContent="center"
          >
            <Image
              key={cachedImageUrls.new}
              source={{ uri: cachedImageUrls.new }}
              style={{ width: "100%", height: "100%", resizeMode: "contain" }}
            />
          </Box>
        </Box>
      )}
      {treeType === "diff" && showHeatmap && cachedImageUrls.diff && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <Box
            flex={1}
            alignItems="center"
            justifyContent="center"
          >
            <Image
              key={cachedImageUrls.diff}
              source={{ uri: cachedImageUrls.diff }}
              style={{ width: "100%", height: "100%", resizeMode: "contain" }}
            />
          </Box>
        </Box>
      )}
      {treeType === "diff" && !showHeatmap && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <React.Fragment key={`${cachedImageUrls.original || ""}-${cachedImageUrls.temp || ""}-${imageCacheKey || 0}`}>
            <DraggableImageCompare
              leftImage={cachedImageUrls.original}
              rightImage={cachedImageUrls.temp}
            />
          </React.Fragment>
        </Box>
      )}
    </>
  );
};

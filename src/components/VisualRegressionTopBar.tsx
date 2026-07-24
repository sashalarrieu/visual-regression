import * as Clipboard from "expo-clipboard";
import React from "react";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { ToggleField } from "../atoms/ToggleField";
import { Typo } from "../atoms/Typo";
import { DIFF_SCREENSHOT_NAME, NEW_SCREENSHOT_NAME } from "../constants/constants";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { spacing } from "../themes/theme";
import type { Node, StoryScreenshotsPath } from "../types/types";

import { ScreenshotDetails } from "./ScreenshotDetails";

export type VisualRegressionTopBarProps = {
  currentStory?: Node;
  treeType: "new" | "diff";
  showHeatmap: boolean;
  countPixelDiff?: number | null;
  storyScreenshotsPath?: StoryScreenshotsPath;
  hasItems?: boolean;
  bulkLoading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onValid: () => void;
  onDelete: () => void;
  onValidAll: () => void;
  onDeleteAll: () => void;
  onShowDeleted: () => void;
  onToggleHeatmap: (value: boolean) => void;
  onOpenCompareModal: () => void;
};

export const VisualRegressionTopBar: React.FC<VisualRegressionTopBarProps> = ({
  currentStory,
  treeType,
  showHeatmap,
  countPixelDiff,
  storyScreenshotsPath,
  hasItems = false,
  bulkLoading = false,
  onPrev,
  onNext,
  onValid,
  onDelete,
  onValidAll,
  onDeleteAll,
  onShowDeleted,
  onToggleHeatmap,
  onOpenCompareModal,
}) => {
  useDeviceConfig();
  const copyStoryPathToClipboard = () => {
    const path = currentStory
      ? currentStory.path.split(`/${treeType === "new" ? NEW_SCREENSHOT_NAME : DIFF_SCREENSHOT_NAME}`)[0]
      : "";
    Clipboard.setStringAsync(path);
  };

  return (
    <Box>
      <Box
        gap="m"
        height={40}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Box
          gap="m"
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Button
            icon={{ name: "chevron-left" }}
            color="base"
            onPress={onPrev}
          />
          <Button
            label="Valider"
            color="primary"
            width={80}
            onPress={onValid}
            disabled={!currentStory || bulkLoading}
          />
          <Button
            label="Refuser"
            color="danger"
            width={80}
            onPress={onDelete}
            disabled={!currentStory || bulkLoading}
          />
          <Button
            label="Tout valider"
            color="primary"
            width={110}
            onPress={onValidAll}
            loading={bulkLoading}
            disabled={!hasItems || bulkLoading}
          />
          <Button
            label="Tout refuser"
            color="danger"
            width={110}
            onPress={onDeleteAll}
            loading={bulkLoading}
            disabled={!hasItems || bulkLoading}
          />
          <Button
            icon={{ name: "chevron-right" }}
            color="base"
            onPress={onNext}
          />
          <Button
            icon={{ name: "content-copy" }}
            color="primary"
            onPress={copyStoryPathToClipboard}
          />
          <Button
            icon={{ name: "sync" }}
            color="primary"
            onPress={onOpenCompareModal}
          />
          <Button
            icon={{ name: "history" }}
            color="primary"
            onPress={onShowDeleted}
          />
        </Box>
        <ScreenshotDetails
          deviceName={currentStory?.deviceName}
          storyId={currentStory?.storyId || currentStory?.name}
          countPixelDiff={storyScreenshotsPath?.diff ? countPixelDiff : undefined}
        />
        <Box
          px="s"
          width={142}
          justifyContent="center"
          alignItems="center"
          borderRadius="base"
          backgroundColor="newTheme_surface"
          style={{ opacity: treeType === "new" ? 0.4 : 1 }}
        >
          <ToggleField
            title={showHeatmap ? "Heatmap" : "Split view"}
            value={showHeatmap}
            onChange={v => onToggleHeatmap(v ?? false)}
            disabled={treeType === "new"}
          />
        </Box>
      </Box>
      <Box
        gap="m"
        height={spacing.m}
        width="100%"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        {treeType === "diff" && !showHeatmap && (
          <Typo
            variant="legend_regular"
            color="newTheme_textLegend"
            textTransform="uppercase"
          >
            Originale
          </Typo>
        )}
        {((treeType === "diff" && !showHeatmap) || treeType === "new") && (
          <Typo
            variant="legend_regular"
            color="newTheme_textLegend"
            textTransform="uppercase"
          >
            Nouvelle
          </Typo>
        )}
        {treeType === "diff" && showHeatmap && (
          <Typo
            variant="legend_regular"
            color="newTheme_textLegend"
            textTransform="uppercase"
          >
            Différence
          </Typo>
        )}
      </Box>
    </Box>
  );
};

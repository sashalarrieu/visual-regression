import * as Clipboard from "expo-clipboard";
import React from "react";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { ToggleField } from "../atoms/ToggleField";
import { Typo } from "../atoms/Typo";
import { DIFF_SCREENSHOT_NAME, NEW_SCREENSHOT_NAME } from "../constants/constants";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { spacing } from "../themes/theme";
import type { Node, StoryScreenshotsPath, StoryType } from "../types/types";
import type { TreePanelMode } from "../utils";

import { ScreenshotDetails } from "./ScreenshotDetails";

export type VisualRegressionTopBarProps = {
  /** Onglet actif — variante actions (catalogue / orphelins). */
  mode?: TreePanelMode;
  currentStory?: Node;
  /** Statut fichier (orphelins baseline / catalogue). */
  storyType?: StoryType;
  treeType: "new" | "diff";
  showHeatmap: boolean;
  countPixelDiff?: number | null;
  storyScreenshotsPath?: StoryScreenshotsPath;
  hasItems?: boolean;
  bulkLoading?: boolean;
  /** Mode multi-sélection (arbre) — adapte la matrice d’actions. */
  multiSelectMode?: boolean;
  /** Nombre de fichiers sélectionnés (paths). */
  selectionCount?: number;
  onPrev: () => void;
  onNext: () => void;
  onValid: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onValidAll: () => void;
  onDeleteAll: () => void;
  onShowDeleted: () => void;
  onToggleHeatmap: (value: boolean) => void;
  onOpenCompareModal: () => void;
  /** Ouvre la modal Capture errors (undefined = bouton masqué). */
  onOpenCaptureErrorsModal?: () => void;
  captureErrorsCount?: number;
};

export const VisualRegressionTopBar: React.FC<VisualRegressionTopBarProps> = ({
  mode = "regressions",
  currentStory,
  storyType,
  treeType,
  showHeatmap,
  countPixelDiff,
  storyScreenshotsPath,
  hasItems = false,
  bulkLoading = false,
  multiSelectMode = false,
  selectionCount = 0,
  onPrev,
  onNext,
  onValid,
  onDelete,
  onRegenerate,
  onValidAll,
  onDeleteAll,
  onShowDeleted,
  onToggleHeatmap,
  onOpenCompareModal,
  onOpenCaptureErrorsModal,
  captureErrorsCount = 0,
}) => {
  useDeviceConfig();
  const effectiveType: StoryType = storyType ?? (treeType === "diff" ? "diff" : "new");
  const isCatalog = mode === "all-stories";
  const isOrphans = mode === "orphans";
  const isRegressions = mode === "regressions";

  const hasActionTarget = multiSelectMode ? selectionCount > 0 : Boolean(currentStory);
  const actionDisabled = !hasActionTarget || bulkLoading;

  const copyStoryPathToClipboard = () => {
    const path = currentStory
      ? currentStory.path.split(`/${treeType === "new" ? NEW_SCREENSHOT_NAME : DIFF_SCREENSHOT_NAME}`)[0]
      : "";
    Clipboard.setStringAsync(path);
  };

  const legendLabels = (() => {
    if (isCatalog) {
      if (effectiveType === "missing") {
        return (
          <Typo
            variant="legend_regular"
            color="newTheme_textLegend"
            textTransform="uppercase"
          >
            Capture absente
          </Typo>
        );
      }
      return (
        <Typo
          variant="legend_regular"
          color="newTheme_textLegend"
          textTransform="uppercase"
        >
          Baseline
        </Typo>
      );
    }

    if (isOrphans) {
      const label =
        effectiveType === "diff"
          ? "Orphelin · diff"
          : effectiveType === "new"
            ? "Orphelin · new"
            : "Orphelin · baseline";
      return (
        <Typo
          variant="legend_regular"
          color="newTheme_textLegend"
          textTransform="uppercase"
        >
          {label}
        </Typo>
      );
    }

    return (
      <>
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
      </>
    );
  })();

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

          {isRegressions && (
            <>
              <Button
                label="Valider"
                color="primary"
                width={80}
                onPress={onValid}
                disabled={actionDisabled}
              />
              <Button
                label="Refuser"
                color="danger"
                width={80}
                onPress={onDelete}
                disabled={actionDisabled}
              />
              {multiSelectMode ? (
                <Button
                  label="Régénérer"
                  color="primary"
                  width={110}
                  onPress={onRegenerate}
                  disabled={actionDisabled}
                />
              ) : (
                <>
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
                </>
              )}
            </>
          )}

          {isCatalog && (
            <>
              <Button
                label="Supprimer"
                color="danger"
                width={100}
                onPress={onDelete}
                disabled={actionDisabled}
              />
              <Button
                label="Régénérer"
                color="primary"
                width={110}
                onPress={onRegenerate}
                disabled={actionDisabled}
              />
            </>
          )}

          {isOrphans && (
            <Button
              label="Régénérer"
              color="primary"
              width={110}
              onPress={onRegenerate}
              disabled={actionDisabled}
            />
          )}

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
          {/* Sync = CompareModal (by-type / all-stories) ; Régénérer = current / sélection. */}
          {(isRegressions || isCatalog) && (
            <Button
              icon={{ name: "sync" }}
              color="primary"
              onPress={onOpenCompareModal}
            />
          )}
          {(isRegressions || isCatalog) && onOpenCaptureErrorsModal && (
            <Button
              icon={{ name: "error-outline" }}
              color="danger"
              onPress={onOpenCaptureErrorsModal}
              number={captureErrorsCount}
              disabled={captureErrorsCount === 0}
            />
          )}
          {isRegressions && (
            <Button
              icon={{ name: "history" }}
              color="primary"
              onPress={onShowDeleted}
            />
          )}
        </Box>
        <ScreenshotDetails
          deviceName={currentStory?.deviceName}
          storyId={currentStory?.storyId || currentStory?.name}
          countPixelDiff={isRegressions && storyScreenshotsPath?.diff ? countPixelDiff : undefined}
        />
        {isRegressions ? (
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
        ) : (
          <Box width={142} />
        )}
      </Box>
      <Box
        gap="m"
        height={spacing.m}
        width="100%"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        {legendLabels}
      </Box>
    </Box>
  );
};

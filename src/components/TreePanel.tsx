import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";

import { Accordion } from "../atoms/Accordion";
import { Box } from "../atoms/Box";
import { Bullet } from "../atoms/Bullet";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { SearchField } from "../atoms/SearchField";
import { Touchable } from "../atoms/Touchable";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { colors, spacing, type ColorKey } from "../themes/theme";
import type { MaterialIconName, Node } from "../types/types";
import {
  calculateFolderDepth,
  collectSelectableFilePaths,
  filterTree,
  findFirstFile,
  formatStoryName,
  getStoryNameFromId,
  isSelectableTreeFile,
  selectionState,
  type SelectionState,
  type StatusFilterValue,
  type TreePanelMode,
} from "../utils";

export type TreePanelProps = {
  tree: Node | null;
  loading: boolean;
  onRefresh: () => void;
  onNodeClick: (node: Node) => void;
  currentStory?: Node;
  onCompareStoryNode?: (node: Node) => void;
  regeneratingPaths?: Set<string>;
  /** Onglet actif — search / chips / icônes. */
  mode?: TreePanelMode;
  searchQuery?: string;
  onSearchQuery?: (query: string) => void;
  statusFilter?: ReadonlySet<StatusFilterValue>;
  onStatusFilter?: (statuses: Set<StatusFilterValue>) => void;
  /** Mode multi-sélection (contrôlé par l’onglet parent). */
  multiSelectMode?: boolean;
  onMultiSelectModeChange?: (enabled: boolean) => void;
  selectedPaths?: ReadonlySet<string>;
  onTogglePath?: (path: string) => void;
  onTogglePaths?: (paths: readonly string[]) => void;
};

type StatusChipDef = { value: StatusFilterValue; label: string };

const STATUS_CHIPS_BY_MODE: Record<TreePanelMode, StatusChipDef[]> = {
  regressions: [
    { value: "new", label: "new" },
    { value: "diff", label: "diff" },
  ],
  "all-stories": [
    { value: "baseline", label: "baseline" },
    { value: "block", label: "block" },
    { value: "missing", label: "missing" },
  ],
  orphans: [],
};

const checkboxIconName = (state: SelectionState): MaterialIconName => {
  if (state === "all") return "check-box";
  if (state === "partial") return "indeterminate-check-box";
  return "check-box-outline-blank";
};

const getFileStatusIcon = (
  fileNode: Node,
  mode: TreePanelMode,
  isCurrentStory: boolean,
): { name: MaterialIconName; fill: ColorKey } => {
  const onPrimary: ColorKey = "newTheme_textOnPrimary";

  if (mode === "all-stories") {
    if (fileNode.ignored) {
      return { name: "block", fill: isCurrentStory ? onPrimary : "newTheme_base10" };
    }
    if (fileNode.storyType === "missing") {
      return { name: "add", fill: isCurrentStory ? onPrimary : "newTheme_primary" };
    }
    return { name: "check", fill: isCurrentStory ? onPrimary : "newTheme_info" };
  }

  // regressions + orphans
  if (fileNode.storyType === "new") {
    return { name: "add", fill: isCurrentStory ? onPrimary : "newTheme_primary" };
  }
  if (fileNode.storyType === "baseline") {
    return { name: "check", fill: isCurrentStory ? onPrimary : "newTheme_base10" };
  }
  return { name: "warning", fill: isCurrentStory ? onPrimary : "newTheme_danger" };
};

const folderTagsForMode = (node: Node, mode: TreePanelMode): React.ReactNode[] => {
  if (mode === "all-stories") {
    return [
      <Bullet
        key="baseline"
        value={node.countBaseline || 0}
        color="newTheme_info"
      />,
      <Bullet
        key="missing"
        value={node.countMissing || 0}
        color="newTheme_primary80"
      />,
      <Bullet
        key="ignored"
        value={node.countIgnored || 0}
        color="newTheme_base10"
      />,
    ];
  }

  return [
    <Bullet
      key="new"
      value={node.countNew || 0}
      color="newTheme_primary80"
    />,
    <Bullet
      key="diff"
      value={node.countDiff || 0}
      color="newTheme_danger"
    />,
    <Bullet
      key="total"
      value={node.countTotal || 0}
      color="newTheme_base10"
    />,
  ];
};

export const TreePanel: React.FC<TreePanelProps> = ({
  tree,
  loading,
  onRefresh,
  onNodeClick,
  currentStory,
  onCompareStoryNode,
  regeneratingPaths = new Set(),
  mode = "regressions",
  searchQuery = "",
  onSearchQuery,
  statusFilter,
  onStatusFilter,
  multiSelectMode = false,
  onMultiSelectModeChange,
  selectedPaths = new Set(),
  onTogglePath,
  onTogglePaths,
}) => {
  const { getDeviceStyle, getDeviceDisplayName } = useDeviceConfig();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const nodeRefs = useRef<Map<string, View>>(new Map());

  const statusChips = STATUS_CHIPS_BY_MODE[mode];
  const selectionCount = selectedPaths.size;

  const displayTree = useMemo(
    () =>
      filterTree(tree, {
        query: searchQuery,
        statuses: statusFilter,
        mode,
      }),
    [tree, searchQuery, statusFilter, mode],
  );

  const firstElementOffset = useMemo(() => {
    const firstFile = findFirstFile(displayTree);
    if (!firstFile?.path) return 0;
    return calculateFolderDepth(firstFile.path) * (48 + spacing.m);
  }, [displayTree]);

  useEffect(() => {
    if (currentStory?.path && scrollViewRef.current && scrollContentRef.current) {
      const nodeRef = nodeRefs.current.get(currentStory.path);
      if (nodeRef) {
        nodeRef.measureLayout(
          scrollContentRef.current,
          (_x, y) => {
            scrollViewRef.current?.scrollTo({ y: Math.max(0, y - firstElementOffset), animated: true });
          },
          () => {},
        );
      }
    }
  }, [currentStory?.path, firstElementOffset]);

  const setNodeRef = useCallback((nodePath: string) => {
    return (ref: View | null) => {
      if (ref) nodeRefs.current.set(nodePath, ref);
      else nodeRefs.current.delete(nodePath);
    };
  }, []);

  const toggleStatus = useCallback(
    (status: StatusFilterValue) => {
      if (!onStatusFilter) return;
      const next = new Set(statusFilter ?? []);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      onStatusFilter(next);
    },
    [statusFilter, onStatusFilter],
  );

  const handleToggleMultiSelect = useCallback(() => {
    onMultiSelectModeChange?.(!multiSelectMode);
  }, [multiSelectMode, onMultiSelectModeChange]);

  const showSync = mode === "regressions" && !!onCompareStoryNode && !multiSelectMode;

  const renderFile = (fileNode: Node) => {
    if (regeneratingPaths.has(fileNode.path)) return null;
    const deviceName = fileNode.deviceName;
    const deviceStyle = getDeviceStyle(deviceName);
    const isCurrentStory = !multiSelectMode && currentStory?.path === fileNode.path;
    const selectable = isSelectableTreeFile(fileNode);
    const isSelected = multiSelectMode && selectable && selectedPaths.has(fileNode.path);
    const deviceDisplayName = deviceName ? getDeviceDisplayName(deviceName) : fileNode.name;
    const statusIcon = getFileStatusIcon(fileNode, mode, isCurrentStory || isSelected);
    const highlight = isCurrentStory || isSelected;

    return (
      <View ref={setNodeRef(fileNode.path)}>
        <Box
          gap="xs"
          flexDirection="row"
          alignItems="center"
          style={{ paddingRight: spacing.m - spacing.s + 1 }}
        >
          {multiSelectMode && selectable && (
            <Touchable
              onPress={() => onTogglePath?.(fileNode.path)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
            >
              <Icon
                name={checkboxIconName(isSelected ? "all" : "none")}
                size="s"
                fill={isSelected ? "newTheme_primary" : "newTheme_textOnSurface"}
                style={{ marginRight: 4 }}
              />
            </Touchable>
          )}
          {multiSelectMode && !selectable && (
            <Icon
              name="block"
              size="s"
              fill="newTheme_base10"
              style={{ marginRight: 4, opacity: 0.5 }}
            />
          )}
          <Button
            label={deviceDisplayName}
            color={highlight ? "primary" : "base"}
            onPress={() => {
              if (multiSelectMode) {
                if (selectable) onTogglePath?.(fileNode.path);
                else onNodeClick(fileNode);
                return;
              }
              onNodeClick(fileNode);
            }}
            disabled={multiSelectMode && !selectable}
            leftIcon={{
              name: deviceStyle.icon,
              fill: (highlight ? "newTheme_textOnPrimary" : deviceStyle.color) as keyof typeof colors,
            }}
            rightIcon={{
              name: statusIcon.name,
              fill: statusIcon.fill,
            }}
            flex={1}
            justifyContent="space-between"
          />
          {showSync && fileNode.storyId && fileNode.deviceName && (
            <Button
              icon={{ name: "sync" }}
              color={isCurrentStory ? "primary" : "base"}
              onPress={() => onCompareStoryNode?.(fileNode)}
            />
          )}
        </Box>
      </View>
    );
  };

  const renderStoryHeader = (storyName: string, storyFiles: Node[]) => {
    const selectableFiles = storyFiles.filter(isSelectableTreeFile);
    const paths = selectableFiles.map(f => f.path);
    const state = selectionState(paths, selectedPaths);

    if (!multiSelectMode) {
      return (
        <Box
          pb="xs"
          px="xs"
        >
          <Typo
            variant="paragraphe_semiBold"
            color="newTheme_textOnSurface"
          >
            {storyName}
          </Typo>
        </Box>
      );
    }

    return (
      <Box
        pb="xs"
        px="xs"
        flexDirection="row"
        alignItems="center"
        gap="xs"
      >
        {paths.length > 0 ? (
          <Touchable
            onPress={() => onTogglePaths?.(paths)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: state === "partial" ? "mixed" : state === "all",
            }}
          >
            <Icon
              name={checkboxIconName(state)}
              size="s"
              fill={state === "none" ? "newTheme_textOnSurface" : "newTheme_primary"}
              style={{ marginRight: 4 }}
            />
          </Touchable>
        ) : (
          <Icon
            name="block"
            size="s"
            fill="newTheme_base10"
            style={{ marginRight: 4, opacity: 0.5 }}
          />
        )}
        <Touchable
          onPress={() => paths.length > 0 && onTogglePaths?.(paths)}
          style={{ flexShrink: 1 }}
          notPressable={paths.length === 0}
        >
          <Typo
            variant="paragraphe_semiBold"
            color="newTheme_textOnSurface"
          >
            {storyName}
          </Typo>
        </Touchable>
      </Box>
    );
  };

  const renderTree = (node: Node | null): React.ReactNode => {
    if (!node) return null;
    const entries = Object.values(node.children ?? {});

    if (node.type === "file") return renderFile(node);

    const files = entries.filter(c => c.type === "file" && !regeneratingPaths.has(c.path));
    const folders = entries.filter(c => c.type === "folder");

    const filesByStoryId = new Map<string, Node[]>();
    files.forEach(file => {
      const storyId = file.storyId || "unknown";
      if (!filesByStoryId.has(storyId)) filesByStoryId.set(storyId, []);
      filesByStoryId.get(storyId)!.push(file);
    });

    const folderPaths = multiSelectMode ? collectSelectableFilePaths(node).filter(p => !regeneratingPaths.has(p)) : [];
    const folderSelection = multiSelectMode ? selectionState(folderPaths, selectedPaths) : "none";

    return (
      <Accordion
        key={node.name}
        label={{ text: node.name }}
        tags={folderTagsForMode(node, mode)}
        defaultOpened
        style={{ paddingBottom: 0 }}
        selectionMode={multiSelectMode}
        selectionState={folderSelection}
        onToggleSelect={multiSelectMode ? () => onTogglePaths?.(folderPaths) : undefined}
      >
        {folders.map((child, index) => (
          <Box
            key={child.name}
            p="xs"
            pb={index === folders.length - 1 && filesByStoryId.size === 0 ? "s" : "none"}
            style={{ right: -spacing.xs - 1, bottom: -1 }}
          >
            {renderTree(child)}
          </Box>
        ))}
        {Array.from(filesByStoryId.entries()).map(([storyId, storyFiles], storyIndex) => {
          const rawStoryName = storyFiles[0]?.displayName || getStoryNameFromId(storyId);
          const storyName = formatStoryName(rawStoryName);
          const isLastStory = storyIndex === filesByStoryId.size - 1;
          return (
            <Box
              key={storyId}
              pb={isLastStory ? "s" : "m"}
              style={{ right: -spacing.xs - 1, bottom: -1 }}
            >
              {renderStoryHeader(storyName, storyFiles)}
              {storyFiles.map((file, fileIndex) => (
                <Box
                  key={file.path}
                  pb={fileIndex === storyFiles.length - 1 ? "none" : "xs"}
                  px="xs"
                >
                  {renderFile(file)}
                </Box>
              ))}
            </Box>
          );
        })}
      </Accordion>
    );
  };

  return (
    <Box
      flex={1}
      p="m"
    >
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        pb="s"
      >
        <Typo
          variant="h2_semiBold"
          style={{ flex: 1, textAlign: "center", paddingVertical: spacing.s }}
        >
          Régressions visuelles
        </Typo>
        <Box
          flexDirection="row"
          gap="xs"
        >
          <Button
            icon={{ name: "checklist" }}
            color={multiSelectMode ? "primary" : "base"}
            onPress={handleToggleMultiSelect}
          />
          <Button
            icon={{ name: "replay" }}
            color="primary"
            onPress={onRefresh}
            loading={loading}
          />
        </Box>
      </Box>

      {multiSelectMode && (
        <Box pb="s">
          <Typo
            variant="legend_regular"
            textAlign="center"
          >
            {selectionCount} sélectionné{selectionCount > 1 ? "s" : ""}
          </Typo>
        </Box>
      )}

      {onSearchQuery && (
        <Box pb="s">
          <SearchField
            value={searchQuery}
            onChangeText={onSearchQuery}
            placeholder="Rechercher une story…"
          />
        </Box>
      )}

      {onStatusFilter && statusChips.length > 0 && (
        <Box
          flexDirection="row"
          gap="xs"
          pb="s"
          style={{ flexWrap: "wrap" }}
        >
          {statusChips.map(chip => {
            const active = statusFilter?.has(chip.value) ?? false;
            return (
              <Touchable
                key={chip.value}
                onPress={() => toggleStatus(chip.value)}
                style={{
                  paddingHorizontal: spacing.s,
                  paddingVertical: spacing.xs,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: active ? colors.newTheme_primary : colors.newTheme_border,
                  backgroundColor: active ? colors.newTheme_primary10 : colors.newTheme_surface,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: active ? colors.newTheme_primary : colors.newTheme_textLegend,
                  }}
                >
                  {chip.label}
                </Text>
              </Touchable>
            );
          })}
        </Box>
      )}

      <ScrollView
        ref={scrollViewRef}
        style={{ marginHorizontal: -spacing.m }}
      >
        <View ref={scrollContentRef}>
          <Box px="m">{renderTree(displayTree)}</Box>
        </View>
      </ScrollView>
    </Box>
  );
};

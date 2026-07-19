import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";

import { Accordion } from "../atoms/Accordion";
import { Box } from "../atoms/Box";
import { Bullet } from "../atoms/Bullet";
import { Button } from "../atoms/Button";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { colors, spacing } from "../themes/theme";
import type { MaterialIconName, Node } from "../types/types";
import { calculateFolderDepth, findFirstFile, formatStoryName, getStoryNameFromId } from "../utils";

export type TreePanelMode = "regressions" | "all-stories";

export type TreePanelProps = {
  tree: Node | null;
  onNodeClick: (node: Node) => void;
  currentStory?: Node;
  onCompareStoryNode?: (node: Node) => void;
  regeneratingPaths?: Set<string>;
  mode?: TreePanelMode;
};

export const TreePanel: React.FC<TreePanelProps> = ({
  tree,
  onNodeClick,
  currentStory,
  onCompareStoryNode,
  regeneratingPaths = new Set(),
  mode = "regressions",
}) => {
  const { getDeviceStyle, getDeviceDisplayName } = useDeviceConfig();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const nodeRefs = useRef<Map<string, View>>(new Map());
  const isCatalog = mode === "all-stories";

  const firstElementOffset = useMemo(() => {
    const firstFile = findFirstFile(tree);
    if (!firstFile?.path) return 0;
    return calculateFolderDepth(firstFile.path) * (48 + spacing.m);
  }, [tree]);

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [mode]);

  useEffect(() => {
    if (currentStory?.path && scrollViewRef.current && scrollContentRef.current) {
      const nodeRef = nodeRefs.current.get(currentStory.path);
      if (nodeRef) {
        // Laisse le layout se stabiliser après un changement d'onglet / d'arbre.
        const frame = requestAnimationFrame(() => {
          nodeRef.measureLayout(
            scrollContentRef.current!,
            (_x, y) => {
              scrollViewRef.current?.scrollTo({ y: Math.max(0, y - firstElementOffset), animated: true });
            },
            () => {},
          );
        });
        return () => cancelAnimationFrame(frame);
      }
    }
  }, [currentStory?.path, firstElementOffset, mode]);

  const setNodeRef = useCallback((nodePath: string) => {
    return (ref: View | null) => {
      if (ref) nodeRefs.current.set(nodePath, ref);
      else nodeRefs.current.delete(nodePath);
    };
  }, []);

  const catalogRightIcon = (fileNode: Node): { name: MaterialIconName; fill: keyof typeof colors } => {
    if (fileNode.ignored) {
      return { name: "block", fill: "newTheme_textLegend" };
    }
    if (fileNode.storyType === "baseline") {
      return { name: "check", fill: "newTheme_primary" };
    }
    return { name: "add", fill: "newTheme_fantasy" };
  };

  const renderFile = (fileNode: Node) => {
    if (!isCatalog && regeneratingPaths.has(fileNode.path)) return null;
    const isNew = fileNode.storyType === "new";
    const deviceName = fileNode.deviceName;
    const deviceStyle = getDeviceStyle(deviceName);
    const isCurrentStory = currentStory?.path === fileNode.path;
    const deviceDisplayName = deviceName ? getDeviceDisplayName(deviceName) : fileNode.name;
    const ignored = Boolean(fileNode.ignored);
    const rightIcon = isCatalog
      ? catalogRightIcon(fileNode)
      : {
          name: (isNew ? "add" : "warning") as MaterialIconName,
          fill: (isCurrentStory
            ? "newTheme_textOnPrimary"
            : isNew
              ? "newTheme_primary"
              : "newTheme_danger") as keyof typeof colors,
        };

    return (
      <View ref={setNodeRef(fileNode.path)}>
        <Box
          gap="xs"
          flexDirection="row"
          alignItems="center"
          style={{
            paddingRight: spacing.m - spacing.s + 1,
            opacity: ignored ? 0.55 : 1,
          }}
        >
          <Button
            label={deviceDisplayName}
            color={isCurrentStory ? "primary" : "base"}
            onPress={() => onNodeClick(fileNode)}
            leftIcon={{
              name: deviceStyle.icon,
              fill: (isCurrentStory
                ? "newTheme_textOnPrimary"
                : ignored
                  ? "newTheme_textLegend"
                  : deviceStyle.color) as keyof typeof colors,
            }}
            rightIcon={{
              name: rightIcon.name,
              fill: (isCurrentStory && !ignored ? "newTheme_textOnPrimary" : rightIcon.fill) as keyof typeof colors,
            }}
            flex={1}
            justifyContent="space-between"
          />
          {onCompareStoryNode && fileNode.storyId && fileNode.deviceName && (
            <Button
              icon={{ name: "sync" }}
              color={isCurrentStory ? "primary" : "base"}
              onPress={() => onCompareStoryNode(fileNode)}
              disabled={ignored}
            />
          )}
        </Box>
      </View>
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

    const diffCount = node.countDiff || 0;
    const newCount = node.countNew || 0;
    const totalCount = node.countTotal || 0;
    const ignoredCount = node.countIgnored || 0;

    const tags = isCatalog
      ? [
          <Bullet
            key="baseline"
            value={newCount}
            color="newTheme_primary80"
            textColor="newTheme_textOnPrimary"
          />,
          <Bullet
            key="missing"
            value={diffCount}
            color="newTheme_fantasy"
            textColor="newTheme_textOnPrimary"
          />,
          <Bullet
            key="ignored"
            value={ignoredCount}
            color="newTheme_info"
            textColor="newTheme_textOnPrimary"
          />,
          <Bullet
            key="total"
            value={totalCount}
            color="newTheme_base"
            textColor="newTheme_textOnPrimary"
          />,
        ]
      : [
          <Bullet
            key="new"
            value={newCount}
            color="newTheme_primary80"
            textColor="newTheme_textOnPrimary"
          />,
          <Bullet
            key="diff"
            value={diffCount}
            color="newTheme_danger"
            textColor="newTheme_textOnPrimary"
          />,
          <Bullet
            key="total"
            value={totalCount}
            color="newTheme_base"
            textColor="newTheme_textOnPrimary"
          />,
        ];

    return (
      <Accordion
        key={node.name}
        label={{ text: node.name }}
        tags={tags}
        defaultOpened
        style={{ paddingBottom: 0 }}
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
          const storyIgnored = storyFiles.every(f => f.ignored);
          return (
            <Box
              key={storyId}
              pb={isLastStory ? "s" : "m"}
              style={{ right: -spacing.xs - 1, bottom: -1, opacity: storyIgnored ? 0.7 : 1 }}
            >
              <Box
                pb="xs"
                px="xs"
                flexDirection="row"
                alignItems="center"
                gap="xs"
              >
                <Typo
                  variant="paragraphe_semiBold"
                  color="newTheme_textOnSurface"
                >
                  {storyName}
                </Typo>
                {storyIgnored && (
                  <Typo
                    variant="legend_regular"
                    color="newTheme_textLegend"
                  >
                    ignore-vr
                  </Typo>
                )}
              </Box>
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
      width={300}
      p="m"
      overflow="hidden"
    >
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1, marginHorizontal: -spacing.m }}
        contentContainerStyle={{ paddingBottom: spacing.m }}
        nestedScrollEnabled
      >
        <View ref={scrollContentRef}>
          <Box px="m">{renderTree(tree)}</Box>
        </View>
      </ScrollView>
    </Box>
  );
};

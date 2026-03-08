import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import {
  calculateFolderDepth,
  findFirstFile,
  formatStoryName,
  getDeviceDisplayName,
  getDeviceStyle,
  getStoryNameFromId,
} from "../utils/VisualRegression";
import type { DeviceName } from "../types";
import type { Node } from "../types";
import { Accordion } from "../primitives/Accordion";
import { Box } from "../primitives/Box";
import { Bullet } from "../primitives/Bullet";
import { Button } from "../primitives/Button";
import { Typo } from "../primitives/Typo";
import { spacing } from "../theme";

export type { Node } from "../types";

export type TreePanelProps = {
  tree: Node | null;
  loading: boolean;
  onRefresh: () => void;
  onNodeClick: (node: Node) => void;
  currentStory?: Node;
  onCompareStoryNode?: (node: Node) => void;
  regeneratingPaths?: Set<string>;
};

export const TreePanel: React.FC<TreePanelProps> = ({
  tree,
  loading,
  onRefresh,
  onNodeClick,
  currentStory,
  onCompareStoryNode,
  regeneratingPaths = new Set(),
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const nodeRefs = useRef<Map<string, View>>(new Map());

  const firstElementOffset = useMemo(() => {
    const firstFile = findFirstFile(tree);
    if (!firstFile?.path) return 0;
    return calculateFolderDepth(firstFile.path) * (48 + spacing.m);
  }, [tree]);

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

  const renderFile = (fileNode: Node) => {
    if (regeneratingPaths.has(fileNode.path)) return null;
    const isNew = fileNode.storyType === "new";
    const deviceName = fileNode.deviceName;
    const deviceStyle = getDeviceStyle(deviceName);
    const isCurrentStory = currentStory?.path === fileNode.path;
    const deviceDisplayName = deviceName ? getDeviceDisplayName(deviceName as DeviceName) : fileNode.name;

    return (
      <View ref={setNodeRef(fileNode.path)}>
        <Box gap="xs" flexDirection="row" alignItems="center" style={{ paddingRight: spacing.m - spacing.s + 1 } as any}>
          <Button
            label={deviceDisplayName}
            color={isCurrentStory ? "primary" : "base"}
            onPress={() => onNodeClick(fileNode)}
            leftIcon={{
              name: deviceStyle.icon,
              fill: (isCurrentStory ? "newTheme_textOnPrimary" : deviceStyle.color) as any,
            }}
            rightIcon={{
              name: isNew ? "plus" : "triangle-exclamation",
              fill: (isCurrentStory ? "newTheme_textOnPrimary" : isNew ? "newTheme_primary" : "newTheme_danger") as any,
            }}
            flex={1}
            justifyContent="space-between"
          />
          {onCompareStoryNode && fileNode.storyId && fileNode.deviceName && (
            <Button
              icon={{ name: "arrows-retweet" }}
              color={isCurrentStory ? "primary" : "base"}
              onPress={() => onCompareStoryNode(fileNode)}
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

    return (
      <Accordion
        key={node.name}
        label={{ text: node.name }}
        tags={[
          <Bullet key="new" value={newCount} color="newTheme_primary80" />,
          <Bullet key="diff" value={diffCount} color="newTheme_danger" />,
          <Bullet key="total" value={totalCount} color="newTheme_base10" />,
        ]}
        defaultOpened
        style={{ paddingBottom: 0 }}
      >
        {folders.map((child, index) => (
          <Box
            key={child.name}
            p="xs"
            pb={index === folders.length - 1 && filesByStoryId.size === 0 ? "s" : "none"}
            style={{ right: -spacing.xs - 1, bottom: -1 } as any}
          >
            {renderTree(child)}
          </Box>
        ))}
        {Array.from(filesByStoryId.entries()).map(([storyId, storyFiles], storyIndex) => {
          const rawStoryName = storyFiles[0]?.displayName || getStoryNameFromId(storyId);
          const storyName = formatStoryName(rawStoryName);
          const isLastStory = storyIndex === filesByStoryId.size - 1;
          return (
            <Box key={storyId} pb={isLastStory ? "s" : "m"} style={{ right: -spacing.xs - 1, bottom: -1 } as any}>
              <Box pb="xs" px="xs">
                <Typo variant="paragraphe_semiBold" color="newTheme_textOnSurface">
                  {storyName}
                </Typo>
              </Box>
              {storyFiles.map((file, fileIndex) => (
                <Box key={file.path} pb={fileIndex === storyFiles.length - 1 ? "none" : "xs"} px="xs">
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
    <Box width={300} p="m">
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" pb="s">
        <Typo variant="h2_semiBold" style={{ flex: 1, textAlign: "center", paddingVertical: spacing.s } as any}>
          Régressions visuelles
        </Typo>
        <Box>
          <Button icon={{ name: "arrows-revert" }} color="primary" onPress={onRefresh} loading={loading} />
        </Box>
      </Box>
      <ScrollView ref={scrollViewRef} style={{ marginHorizontal: -spacing.m }}>
        <View ref={scrollContentRef}>
          <Box px="m">{renderTree(tree)}</Box>
        </View>
      </ScrollView>
    </Box>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { EndOfList } from "../atoms/EndOfList";
import { Modal } from "../atoms/Modal";
import { TabBar, type TabBarTab } from "../atoms/TabBar";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { spacing } from "../themes/theme";
import type { DeletedItem, MaterialIconName, Node, StoryDevicePair } from "../types/types";
import { formatStoryIdForDisplay, fetchStorybookStoryCount } from "../utils";

import { DeletedItemRow } from "./DeletedItemRow";

export type CompareModalProps = {
  visible: boolean;
  onClose: () => void;
  deletedList: DeletedItem[];
  allList: Node[];
  onCompareSelected: (stories: StoryDevicePair[]) => void;
  onCompareStory?: (storyId: string, deviceName: string, componentDir?: string) => void;
  onCompareByType: (type: "new" | "diff" | "rejected", deviceName?: string) => Promise<void>;
  onCompareAllStories: (deviceName?: string) => Promise<void>;
  loading?: boolean;
};

export const CompareModal: React.FC<CompareModalProps> = ({
  visible,
  onClose,
  deletedList,
  allList,
  onCompareSelected,
  onCompareStory,
  onCompareByType,
  onCompareAllStories,
  loading = false,
}) => {
  const { getDeviceStyle, getDeviceDisplayName, deviceConfigs } = useDeviceConfig();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDevice, setSelectedDevice] = useState<string | "all">("all");
  const [storybookStoryCount, setStorybookStoryCount] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchStorybookStoryCount().then(count => {
      if (!cancelled) setStorybookStoryCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (visible) setSelectedItems(new Set());
  }, [visible, selectedDevice]);

  const availableDevices = useMemo<string[]>(() => {
    const deviceSet = new Set<string>();
    allList.forEach(node => {
      if (node.deviceName) deviceSet.add(node.deviceName);
    });
    deletedList.forEach(item => {
      if (item.deviceName) deviceSet.add(item.deviceName);
    });
    return Array.from(deviceSet).sort();
  }, [allList, deletedList]);

  const deviceCounts = useMemo(() => {
    const counts = new Map<string | "all", number>();
    counts.set("all", deletedList.filter(item => item.storyId && item.deviceName).length);
    availableDevices.forEach(device => {
      counts.set(device, deletedList.filter(item => item.deviceName === device && item.storyId).length);
    });
    return counts;
  }, [deletedList, availableDevices]);

  const deviceTabs = useMemo<TabBarTab<string>[]>(() => {
    return [
      {
        key: "all",
        title: "Tous",
        icon: { name: "grid-view" },
        alertTextInfo: deviceCounts.get("all") || 0,
      },
      ...availableDevices.map(device => {
        const deviceStyle = getDeviceStyle(device);
        return {
          key: device,
          title: getDeviceDisplayName(device),
          icon: { name: deviceStyle.icon, fill: deviceStyle.color },
          alertTextInfo: deviceCounts.get(device) || 0,
        };
      }),
    ];
  }, [availableDevices, deviceCounts, getDeviceStyle, getDeviceDisplayName]);

  const filteredDeletedList = useMemo(() => {
    if (selectedDevice === "all") return deletedList;
    return deletedList.filter(item => item.deviceName === selectedDevice);
  }, [deletedList, selectedDevice]);

  const validStories = useMemo(
    () => filteredDeletedList.filter(item => item.storyId && item.deviceName),
    [filteredDeletedList],
  );

  type GroupedStory = { storyId: string; storyName: string; items: DeletedItem[] };
  const groupedStories = useMemo<GroupedStory[]>(() => {
    const groups = new Map<string, DeletedItem[]>();
    validStories.forEach(item => {
      const storyId = item.storyId!;
      if (!groups.has(storyId)) groups.set(storyId, []);
      groups.get(storyId)!.push(item);
    });
    return Array.from(groups.entries()).map(([storyId, items]) => ({
      storyId,
      storyName: formatStoryIdForDisplay(storyId),
      items,
    }));
  }, [validStories]);

  const toggleItem = useCallback((fullPath: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelectedItems(new Set(validStories.map(item => item.fullPath))),
    [validStories],
  );
  const deselectAll = useCallback(() => setSelectedItems(new Set()), []);

  const allSelected = useMemo(
    () => validStories.length > 0 && validStories.every(item => selectedItems.has(item.fullPath)),
    [validStories, selectedItems],
  );

  const handleCompareSelected = useCallback(() => {
    const selected = validStories
      .filter(item => selectedItems.has(item.fullPath))
      .map(item => {
        const normalized = item.fullPath.replace(/\\/g, "/");
        const lastSlash = normalized.lastIndexOf("/");
        return {
          storyId: item.storyId!,
          deviceName: item.deviceName!,
          componentDir: lastSlash > 0 ? normalized.slice(0, lastSlash) : undefined,
        };
      });
    if (selected.length > 0) {
      onCompareSelected(selected);
      onClose();
    }
  }, [validStories, selectedItems, onCompareSelected, onClose]);

  const handleCompareSingleStory = useCallback(
    (item: DeletedItem) => {
      if (!item.storyId || !item.deviceName || !onCompareStory) return;
      const normalized = item.fullPath.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      const componentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : undefined;
      onCompareStory(item.storyId, item.deviceName, componentDir);
    },
    [onCompareStory],
  );

  const handleCompareAllForDevice = useCallback(async () => {
    const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
    await onCompareAllStories(deviceName);
    onClose();
  }, [selectedDevice, onCompareAllStories, onClose]);

  const handleCompareByTypeForDevice = useCallback(
    async (type: "new" | "diff" | "rejected") => {
      const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
      await onCompareByType(type, deviceName);
      onClose();
    },
    [selectedDevice, onCompareByType, onClose],
  );

  const storyCountsByType = useMemo(() => {
    const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
    const filteredRejected = deviceName
      ? deletedList.filter(item => item.deviceName === deviceName && item.storyId)
      : deletedList.filter(item => item.storyId);
    const devicesForAllCount = selectedDevice === "all" ? (deviceConfigs?.length ?? availableDevices.length) : 1;
    return {
      all: storybookStoryCount * devicesForAllCount,
      new: filteredRejected.filter(item => !item.isDiff).length,
      diff: filteredRejected.filter(item => item.isDiff).length,
      rejected: filteredRejected.length,
    };
  }, [selectedDevice, deletedList, storybookStoryCount, deviceConfigs, availableDevices.length]);

  const compareButtons = useMemo<
    {
      label: string;
      onPress: () => void;
      icon: { name: MaterialIconName };
      number: number;
      color?: "danger" | "primary";
    }[]
  >(
    () => [
      {
        label: "Tous",
        onPress: handleCompareAllForDevice,
        icon: { name: "grid-view" },
        number: storyCountsByType.all,
        color: "danger" as const,
      },
      {
        label: "New",
        onPress: () => handleCompareByTypeForDevice("new"),
        icon: { name: "add" },
        number: storyCountsByType.new,
      },
      {
        label: "Diff",
        onPress: () => handleCompareByTypeForDevice("diff"),
        icon: { name: "warning" },
        number: storyCountsByType.diff,
      },
      {
        label: "Refusé",
        onPress: () => handleCompareByTypeForDevice("rejected"),
        icon: { name: "delete-outline" },
        number: storyCountsByType.rejected,
      },
    ],
    [handleCompareAllForDevice, handleCompareByTypeForDevice, storyCountsByType],
  );

  return (
    <Modal
      isOpen={visible}
      onClose={onClose}
      header={{
        title: { text: "Régénérer les comparaisons" },
        subtitle:
          "Sélectionnez les stories refusées à régénérer ou choisissez un device et régénérez les nouvelles, les différences, les refusés ou toutes les stories pour ce device.",
        children: availableDevices.length > 0 && (
          <Box
            gap="m"
            pb="m"
          >
            <Box gap="s">
              <Typo
                variant="paragraphe_semiBold"
                color="newTheme_textOnSurface"
              >
                Régénérer par device
              </Typo>
              <TabBar
                tabs={deviceTabs}
                selectedTabKey={selectedDevice}
                onSelectedTabKey={key => setSelectedDevice(key as string | "all")}
                compressed
                onBackground
              />
              <Box
                gap="s"
                flexDirection="row"
                style={{ flexWrap: "wrap" }}
              >
                {compareButtons.map(({ label, onPress, icon, number, color }) => (
                  <Button
                    key={label}
                    label={label}
                    leftIcon={icon}
                    color={color ?? "primary"}
                    onPress={onPress}
                    disabled={loading || number === 0}
                    number={number}
                    flex={1}
                  />
                ))}
              </Box>
            </Box>
            <Box
              gap="s"
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typo
                variant="legend_regular"
                color="newTheme_textLegend"
              >
                {selectedItems.size}/{validStories.length} sélectionnée{selectedItems.size > 1 ? "s" : ""}
              </Typo>
              <Button
                title={{ text: allSelected ? "Tout désélectionner" : "Tout sélectionner" }}
                color="base"
                onPress={allSelected ? deselectAll : selectAll}
                disabled={validStories.length === 0 || loading}
              />
            </Box>
          </Box>
        ),
      }}
      footer={{
        buttons: {
          left: { title: { text: "Annuler" }, onPress: onClose, disabled: loading, color: "base" },
          right: {
            title: { text: "Régénérer la sélection" },
            onPress: handleCompareSelected,
            disabled: selectedItems.size === 0 || loading,
            color: "primary",
          },
        },
      }}
      content={
        <Box gap="s">
          {selectedDevice === "all" ? (
            <FlatList<GroupedStory>
              data={groupedStories}
              contentContainerStyle={{ flex: 1, gap: spacing.m, paddingBottom: 50 }}
              keyExtractor={g => g.storyId}
              showsVerticalScrollIndicator
              renderItem={({ item: group }) => (
                <Box gap="s">
                  <Typo
                    variant="paragraphe_semiBold"
                    color="newTheme_textOnSurface"
                  >
                    {group.storyName}
                  </Typo>
                  <Box gap="xs">
                    {group.items.map(storyItem => {
                      const isSelected = selectedItems.has(storyItem.fullPath);
                      return (
                        <Box key={storyItem.fullPath}>
                          <DeletedItemRow
                            item={storyItem}
                            onRestore={() => handleCompareSingleStory(storyItem)}
                            selected={isSelected}
                            onSelect={toggleItem}
                            disabled={loading}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              )}
              ListEmptyComponent={
                <EndOfList
                  nbItem={groupedStories.length}
                  emptyText={validStories.length === 0 ? "Aucune story refusée à régénérer" : "Aucune story refusée"}
                />
              }
            />
          ) : (
            <FlatList<DeletedItem>
              data={validStories}
              contentContainerStyle={{ flex: 1, gap: spacing.xs, paddingBottom: 50 }}
              keyExtractor={item => item.fullPath}
              showsVerticalScrollIndicator
              renderItem={({ item: storyItem }) => (
                <DeletedItemRow
                  item={storyItem}
                  onRestore={() => handleCompareSingleStory(storyItem)}
                  selected={selectedItems.has(storyItem.fullPath)}
                  onSelect={toggleItem}
                  disabled={loading}
                />
              )}
              ListEmptyComponent={
                <EndOfList
                  nbItem={validStories.length}
                  emptyText={
                    validStories.length === 0
                      ? `Aucune story refusée pour ${getDeviceDisplayName(selectedDevice)}`
                      : "Aucune story refusée"
                  }
                />
              }
            />
          )}
        </Box>
      }
    />
  );
};

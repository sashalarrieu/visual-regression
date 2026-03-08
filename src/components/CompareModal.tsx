import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList } from "react-native";
import {
  DeviceName,
  formatStoryIdForDisplay,
  getDeviceDisplayName,
  getDeviceStyle,
} from "../utils/VisualRegression";
import type { DeletedItem } from "./DeletedItemRow";
import { DeletedItemRow } from "./DeletedItemRow";
import type { Node } from "./TreePanel";
import { Box } from "../primitives/Box";
import { Button } from "../primitives/Button";
import { EndOfList } from "../primitives/EndOfList";
import { Modal } from "../primitives/Modal";
import { TabBar } from "../primitives/TabBar";
import { Typo } from "../primitives/Typo";
import { spacing } from "../theme";

export type CompareModalProps = {
  visible: boolean;
  onClose: () => void;
  deletedList: DeletedItem[];
  allList: Node[];
  onCompareSelected: (stories: { storyId: string; deviceName: DeviceName }[]) => void;
  onCompareStory?: (storyId: string, deviceName: DeviceName) => void;
  onCompareByType: (type: "new" | "diff" | "rejected", deviceName?: DeviceName) => Promise<void>;
  onCompareAllStories: (deviceName?: DeviceName) => Promise<void>;
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
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDevice, setSelectedDevice] = useState<DeviceName | "all">("all");

  useEffect(() => {
    if (visible) setSelectedItems(new Set());
  }, [visible, selectedDevice]);

  const availableDevices = useMemo<DeviceName[]>(() => {
    const deviceSet = new Set<DeviceName>();
    const validSet = new Set<DeviceName>(Object.values(DeviceName));
    allList.forEach(node => {
      if (node.deviceName && validSet.has(node.deviceName)) deviceSet.add(node.deviceName);
    });
    deletedList.forEach(item => {
      if (item.deviceName && validSet.has(item.deviceName as DeviceName)) deviceSet.add(item.deviceName as DeviceName);
    });
    return Array.from(deviceSet).sort();
  }, [allList, deletedList]);

  const deviceCounts = useMemo(() => {
    const counts = new Map<DeviceName | "all", number>();
    counts.set("all", deletedList.filter(item => item.storyId && item.deviceName).length);
    availableDevices.forEach(device => {
      counts.set(device, deletedList.filter(item => item.deviceName === device && item.storyId).length);
    });
    return counts;
  }, [deletedList, availableDevices]);

  const deviceTabs = useMemo(() => {
    return [
      { key: "all" as const, title: "Tous", icon: { name: "squares-group" }, alertTextInfo: deviceCounts.get("all") || 0 },
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
  }, [availableDevices, deviceCounts]);

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

  const selectAll = useCallback(() => setSelectedItems(new Set(validStories.map(item => item.fullPath))), [validStories]);
  const deselectAll = useCallback(() => setSelectedItems(new Set()), []);

  const allSelected = useMemo(
    () => validStories.length > 0 && validStories.every(item => selectedItems.has(item.fullPath)),
    [validStories, selectedItems],
  );

  const handleCompareSelected = useCallback(() => {
    const selected = validStories
      .filter(item => selectedItems.has(item.fullPath))
      .map(item => ({ storyId: item.storyId!, deviceName: item.deviceName! }));
    if (selected.length > 0) {
      onCompareSelected(selected);
      onClose();
    }
  }, [validStories, selectedItems, onCompareSelected, onClose]);

  const handleCompareSingleStory = useCallback(
    (item: DeletedItem) => {
      if (item.storyId && item.deviceName && onCompareStory) onCompareStory(item.storyId, item.deviceName);
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
    const allStoriesForDevice = deviceName
      ? allList.filter(node => node.deviceName === deviceName && node.storyId)
      : allList.filter(node => node.storyId);
    return {
      all: allStoriesForDevice.length + filteredRejected.length,
      new: filteredRejected.filter(item => !item.isDiff).length,
      diff: filteredRejected.filter(item => item.isDiff).length,
      rejected: filteredRejected.length,
    };
  }, [selectedDevice, allList, deletedList]);

  const compareButtons = useMemo(
    () => [
      { label: "Tous", onPress: handleCompareAllForDevice, icon: { name: "squares-group" }, number: storyCountsByType.all, color: "danger" as const },
      { label: "New", onPress: () => handleCompareByTypeForDevice("new"), icon: { name: "plus" }, number: storyCountsByType.new },
      { label: "Diff", onPress: () => handleCompareByTypeForDevice("diff"), icon: { name: "triangle-exclamation" }, number: storyCountsByType.diff },
      { label: "Refusé", onPress: () => handleCompareByTypeForDevice("rejected"), icon: { name: "trash" }, number: storyCountsByType.rejected },
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
          <Box gap="m" pb="m">
            <Box gap="s">
              <Typo variant="paragraphe_semiBold" color="newTheme_textOnSurface">
                Régénérer par device
              </Typo>
              <TabBar
                tabs={deviceTabs}
                selectedTabKey={selectedDevice}
                onSelectedTabKey={key => setSelectedDevice(key as DeviceName | "all")}
                compressed
                onBackground
              />
              <Box gap="s" flexDirection="row" style={{ flexWrap: "wrap" } as any}>
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
            <Box gap="s" flexDirection="row" alignItems="center" justifyContent="space-between">
              <Typo variant="legend_regular" color="newTheme_textLegend">
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
                  <Typo variant="paragraphe_semiBold" color="newTheme_textOnSurface">
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

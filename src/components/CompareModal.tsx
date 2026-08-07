import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "../atoms/Box";
import { Bullet } from "../atoms/Bullet";
import { Button } from "../atoms/Button";
import { EndOfList } from "../atoms/EndOfList";
import { Modal } from "../atoms/Modal";
import { TabBar, type TabBarTab } from "../atoms/TabBar";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { spacing, type ColorKey } from "../themes/theme";
import type { DeletedItem, MaterialIconName, Node, StoryDevicePair } from "../types/types";
import { fetchStorybookStoryCount, formatStoryIdForDisplay } from "../utils";

import { DeletedItemRow } from "./DeletedItemRow";

export type CompareHistoryMode = "rejected" | "validated";

export type CompareModalProps = {
  visible: boolean;
  onClose: () => void;
  deletedList: DeletedItem[];
  validatedList: DeletedItem[];
  allList: Node[];
  /** Nombre de stories VR éligibles (catalogue) — évite un badge/disable à 0 avant fetch. */
  storyCount?: number;
  onCompareSelected: (stories: StoryDevicePair[]) => void | Promise<void>;
  onCompareStory?: (storyId: string, deviceName: string, componentDir?: string) => void | Promise<void>;
  onCompareByType: (
    type: "new" | "diff" | "rejected" | "validated",
    deviceName?: string,
    history?: "deleted" | "validated",
  ) => void | Promise<void>;
  onCompareAllStories: (deviceName?: string) => void | Promise<void>;
  loading?: boolean;
};

export const CompareModal: React.FC<CompareModalProps> = ({
  visible,
  onClose,
  deletedList,
  validatedList,
  allList,
  storyCount: storyCountProp,
  onCompareSelected,
  onCompareStory,
  onCompareByType,
  onCompareAllStories,
  loading = false,
}) => {
  const { getDeviceStyle, getDeviceDisplayName, deviceConfigs } = useDeviceConfig();
  const [historyMode, setHistoryMode] = useState<CompareHistoryMode>("rejected");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDevice, setSelectedDevice] = useState<string | "all">("all");
  /** `null` = pas encore résolu → le bouton « Tous » reste cliquable. */
  const [storybookStoryCount, setStorybookStoryCount] = useState<number | null>(() =>
    typeof storyCountProp === "number" && storyCountProp > 0 ? storyCountProp : null,
  );

  const activeList = historyMode === "rejected" ? deletedList : validatedList;
  const historySource = historyMode === "rejected" ? "deleted" : "validated";

  useEffect(() => {
    if (typeof storyCountProp === "number" && storyCountProp > 0) {
      setStorybookStoryCount(storyCountProp);
    }
  }, [storyCountProp]);

  useEffect(() => {
    if (!visible) return;
    if (typeof storyCountProp === "number" && storyCountProp > 0) return;
    let cancelled = false;
    fetchStorybookStoryCount().then(count => {
      // Ne pas écraser un compteur déjà connu avec un 0 (fetch Storybook KO côté navigateur).
      if (cancelled) return;
      if (count > 0) setStorybookStoryCount(count);
      else setStorybookStoryCount(prev => (prev != null && prev > 0 ? prev : 0));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, storyCountProp]);

  useEffect(() => {
    if (visible) {
      setSelectedItems(new Set());
      setHistoryMode("rejected");
    }
  }, [visible]);

  useEffect(() => {
    setSelectedItems(new Set());
  }, [selectedDevice, historyMode]);

  const configuredDevices = useMemo<string[]>(() => {
    if (deviceConfigs?.length) {
      return deviceConfigs.map(d => d.name).sort();
    }
    const deviceSet = new Set<string>();
    allList.forEach(node => {
      if (node.deviceName) deviceSet.add(node.deviceName);
    });
    deletedList.forEach(item => {
      if (item.deviceName) deviceSet.add(item.deviceName);
    });
    validatedList.forEach(item => {
      if (item.deviceName) deviceSet.add(item.deviceName);
    });
    return Array.from(deviceSet).sort();
  }, [deviceConfigs, allList, deletedList, validatedList]);

  useEffect(() => {
    if (selectedDevice !== "all" && configuredDevices.length > 0 && !configuredDevices.includes(selectedDevice)) {
      setSelectedDevice("all");
    }
  }, [configuredDevices, selectedDevice]);

  const historyTabs = useMemo<TabBarTab<CompareHistoryMode>[]>(
    () => [
      {
        key: "rejected",
        title: "Refusés",
        badge: (
          <Bullet
            value={deletedList.length}
            color="newTheme_danger"
          />
        ),
      },
      {
        key: "validated",
        title: "Validés",
        badge: (
          <Bullet
            value={validatedList.length}
            color="newTheme_primary"
          />
        ),
      },
    ],
    [deletedList.length, validatedList.length],
  );

  const deviceCounts = useMemo(() => {
    const counts = new Map<string | "all", number>();
    counts.set("all", activeList.filter(item => item.storyId && item.deviceName).length);
    configuredDevices.forEach(device => {
      counts.set(device, activeList.filter(item => item.deviceName === device && item.storyId).length);
    });
    return counts;
  }, [activeList, configuredDevices]);

  const deviceTabs = useMemo<TabBarTab<string>[]>(() => {
    return [
      {
        key: "all",
        title: "Tous",
        icon: { name: "grid-view" },
        badge: (
          <Bullet
            value={deviceCounts.get("all") || 0}
            color="newTheme_base10"
          />
        ),
      },
      ...configuredDevices.map(device => {
        const deviceStyle = getDeviceStyle(device);
        const count = deviceCounts.get(device) || 0;
        return {
          key: device,
          title: getDeviceDisplayName(device),
          icon: { name: deviceStyle.icon, fill: deviceStyle.color },
          badge: (
            <Bullet
              value={count}
              color={deviceStyle.color as ColorKey}
            />
          ),
        };
      }),
    ];
  }, [configuredDevices, deviceCounts, getDeviceStyle, getDeviceDisplayName]);

  const filteredList = useMemo(() => {
    if (selectedDevice === "all") return activeList;
    return activeList.filter(item => item.deviceName === selectedDevice);
  }, [activeList, selectedDevice]);

  const validStories = useMemo(() => filteredList.filter(item => item.storyId && item.deviceName), [filteredList]);

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
    if (selected.length === 0) return;
    // Fermer d'abord : la compare côté serveur peut durer longtemps (HTTP bloquant).
    onClose();
    void onCompareSelected(selected);
  }, [validStories, selectedItems, onCompareSelected, onClose]);

  const handleCompareSingleStory = useCallback(
    (item: DeletedItem) => {
      if (!item.storyId || !item.deviceName || !onCompareStory) return;
      const normalized = item.fullPath.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      const componentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : undefined;
      void onCompareStory(item.storyId, item.deviceName, componentDir);
    },
    [onCompareStory],
  );

  const handleCompareAllForDevice = useCallback(() => {
    const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
    onClose();
    void onCompareAllStories(deviceName);
  }, [selectedDevice, onCompareAllStories, onClose]);

  const handleCompareByTypeForDevice = useCallback(
    (type: "new" | "diff" | "rejected" | "validated") => {
      const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
      onClose();
      void onCompareByType(type, deviceName, historySource);
    },
    [selectedDevice, onCompareByType, onClose, historySource],
  );

  const storyCountsByType = useMemo(() => {
    const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
    const filtered = deviceName
      ? activeList.filter(item => item.deviceName === deviceName && item.storyId)
      : activeList.filter(item => item.storyId);
    const deviceCount = deviceConfigs?.length || configuredDevices.length || 1;
    const devicesForAllCount = selectedDevice === "all" ? deviceCount : 1;
    const resolvedStoryCount = storybookStoryCount ?? 0;
    return {
      all: resolvedStoryCount * devicesForAllCount,
      new: filtered.filter(item => !item.isDiff).length,
      diff: filtered.filter(item => item.isDiff).length,
      history: filtered.length,
    };
  }, [selectedDevice, activeList, storybookStoryCount, deviceConfigs, configuredDevices.length]);

  /** « Tous » : disabled seulement si compare en cours, ou 0 story confirmée dans le projet. */
  const isAllStoriesDisabled = loading || storybookStoryCount === 0;

  const historyBulkLabel = historyMode === "rejected" ? "Refusé" : "Validé";
  const historyBulkType = historyMode === "rejected" ? "rejected" : "validated";
  const emptyLabel = historyMode === "rejected" ? "refusée" : "validée";

  const compareButtons = useMemo<
    {
      label: string;
      onPress: () => void;
      icon: { name: MaterialIconName };
      number: number;
      color?: "danger" | "primary";
      disabled: boolean;
    }[]
  >(
    () => [
      {
        label: "Tous",
        onPress: handleCompareAllForDevice,
        icon: { name: "grid-view" },
        number: storyCountsByType.all,
        color: "danger" as const,
        disabled: isAllStoriesDisabled,
      },
      {
        label: "New",
        onPress: () => handleCompareByTypeForDevice("new"),
        icon: { name: "add" },
        number: storyCountsByType.new,
        disabled: loading || storyCountsByType.new === 0,
      },
      {
        label: "Diff",
        onPress: () => handleCompareByTypeForDevice("diff"),
        icon: { name: "warning" },
        number: storyCountsByType.diff,
        disabled: loading || storyCountsByType.diff === 0,
      },
      {
        label: historyBulkLabel,
        onPress: () => handleCompareByTypeForDevice(historyBulkType),
        icon: { name: historyMode === "rejected" ? "delete-outline" : "check" },
        number: storyCountsByType.history,
        disabled: loading || storyCountsByType.history === 0,
      },
    ],
    [
      handleCompareAllForDevice,
      handleCompareByTypeForDevice,
      storyCountsByType,
      historyBulkLabel,
      historyBulkType,
      historyMode,
      isAllStoriesDisabled,
      loading,
    ],
  );

  return (
    <Modal
      isOpen={visible}
      onClose={onClose}
      header={{
        title: { text: "Régénérer les comparaisons" },
        subtitle:
          historyMode === "rejected"
            ? "Sélectionnez des stories refusées à régénérer, ou lancez New / Diff / Refusé / Toutes pour le device choisi."
            : "Sélectionnez des stories validées à régénérer, ou lancez New / Diff / Validé / Toutes pour le device choisi.",
        children: (
          <Box
            gap="m"
            pb="m"
          >
            <Box gap="s">
              <Typo
                variant="paragraphe_semiBold"
                color="newTheme_textOnSurface"
              >
                Historique
              </Typo>
              <TabBar
                tabs={historyTabs}
                selectedTabKey={historyMode}
                onSelectedTabKey={setHistoryMode}
                compressed
                onBackground
              />
            </Box>
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
                {compareButtons.map(({ label, onPress, icon, number, color, disabled }) => (
                  <Button
                    key={label}
                    label={label}
                    leftIcon={icon}
                    color={color ?? "primary"}
                    onPress={onPress}
                    disabled={disabled}
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
                  emptyText={
                    validStories.length === 0 ? `Aucune story ${emptyLabel} à régénérer` : `Aucune story ${emptyLabel}`
                  }
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
                      ? `Aucune story ${emptyLabel} pour ${getDeviceDisplayName(selectedDevice)}`
                      : `Aucune story ${emptyLabel}`
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

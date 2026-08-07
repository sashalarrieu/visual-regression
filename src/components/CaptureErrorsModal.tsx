import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList } from "react-native";

import { Box } from "../atoms/Box";
import { Bullet } from "../atoms/Bullet";
import { Button } from "../atoms/Button";
import { EndOfList } from "../atoms/EndOfList";
import { Modal } from "../atoms/Modal";
import { TabBar, type TabBarTab } from "../atoms/TabBar";
import { Touchable } from "../atoms/Touchable";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { spacing, type ColorKey } from "../themes/theme";
import type { CaptureErrorItem, StoryDevicePair } from "../types/types";
import { formatStoryIdForDisplay } from "../utils";

import { ScreenshotDetails } from "./ScreenshotDetails";

export type CaptureErrorsModalProps = {
  visible: boolean;
  onClose: () => void;
  errors: CaptureErrorItem[];
  onCompareSelected: (stories: StoryDevicePair[]) => void;
  onCompareStory?: (storyId: string, deviceName: string, componentDir?: string) => void;
  onCompareAllErrors: (deviceName?: string) => void;
  loading?: boolean;
};

type CaptureErrorRowProps = {
  item: CaptureErrorItem;
  selected: boolean;
  disabled?: boolean;
  onSelect: (key: string) => void;
  onRetry: (item: CaptureErrorItem) => void;
};

const errorItemKey = (item: CaptureErrorItem): string => `${item.deviceName}::${item.storyId}`;

const CaptureErrorRow: React.FC<CaptureErrorRowProps> = ({ item, selected, disabled, onSelect, onRetry }) => {
  useDeviceConfig();
  const key = errorItemKey(item);

  return (
    <Box
      flex={1}
      backgroundColor={selected ? "newTheme_primary10" : "newTheme_surface"}
      borderColor={selected ? "newTheme_primary" : "newTheme_background"}
      borderWidth={1}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap="m"
      p="m"
      borderRadius="base"
    >
      <Touchable
        onPress={() => onSelect(key)}
        notPressable={disabled}
        style={{ flex: 1, gap: 8 }}
      >
        <ScreenshotDetails
          deviceName={item.deviceName}
          storyId={item.storyId}
        />
        <Typo
          variant="legend_regular"
          color="newTheme_danger"
          numberOfLines={3}
        >
          {item.message}
        </Typo>
      </Touchable>
      <Button
        onPress={() => onRetry(item)}
        icon={{ name: "sync" }}
        color="base"
        disabled={disabled}
      />
    </Box>
  );
};

export const CaptureErrorsModal: React.FC<CaptureErrorsModalProps> = ({
  visible,
  onClose,
  errors,
  onCompareSelected,
  onCompareStory,
  onCompareAllErrors,
  loading = false,
}) => {
  const { getDeviceStyle, getDeviceDisplayName, deviceConfigs } = useDeviceConfig();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDevice, setSelectedDevice] = useState<string | "all">("all");

  useEffect(() => {
    if (visible) {
      setSelectedItems(new Set());
      setSelectedDevice("all");
    }
  }, [visible]);

  useEffect(() => {
    setSelectedItems(new Set());
  }, [selectedDevice]);

  const configuredDevices = useMemo<string[]>(() => {
    if (deviceConfigs?.length) {
      return deviceConfigs.map(d => d.name).sort();
    }
    return Array.from(new Set(errors.map(item => item.deviceName))).sort();
  }, [deviceConfigs, errors]);

  useEffect(() => {
    if (selectedDevice !== "all" && configuredDevices.length > 0 && !configuredDevices.includes(selectedDevice)) {
      setSelectedDevice("all");
    }
  }, [configuredDevices, selectedDevice]);

  const deviceCounts = useMemo(() => {
    const counts = new Map<string | "all", number>();
    counts.set("all", errors.length);
    configuredDevices.forEach(device => {
      counts.set(device, errors.filter(item => item.deviceName === device).length);
    });
    return counts;
  }, [errors, configuredDevices]);

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
    if (selectedDevice === "all") return errors;
    return errors.filter(item => item.deviceName === selectedDevice);
  }, [errors, selectedDevice]);

  type GroupedError = { storyId: string; storyName: string; items: CaptureErrorItem[] };
  const groupedErrors = useMemo<GroupedError[]>(() => {
    const groups = new Map<string, CaptureErrorItem[]>();
    filteredList.forEach(item => {
      if (!groups.has(item.storyId)) groups.set(item.storyId, []);
      groups.get(item.storyId)!.push(item);
    });
    return Array.from(groups.entries()).map(([storyId, items]) => ({
      storyId,
      storyName: formatStoryIdForDisplay(storyId),
      items,
    }));
  }, [filteredList]);

  const toggleItem = useCallback((key: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelectedItems(new Set(filteredList.map(errorItemKey))), [filteredList]);
  const deselectAll = useCallback(() => setSelectedItems(new Set()), []);

  const allSelected = useMemo(
    () => filteredList.length > 0 && filteredList.every(item => selectedItems.has(errorItemKey(item))),
    [filteredList, selectedItems],
  );

  const handleCompareSelected = useCallback(() => {
    const selected = filteredList
      .filter(item => selectedItems.has(errorItemKey(item)))
      .map(item => ({
        storyId: item.storyId,
        deviceName: item.deviceName,
        componentDir: item.componentDir || undefined,
      }));
    if (selected.length > 0) {
      onCompareSelected(selected);
      onClose();
    }
  }, [filteredList, selectedItems, onCompareSelected, onClose]);

  const handleRetrySingle = useCallback(
    (item: CaptureErrorItem) => {
      if (!onCompareStory) return;
      onCompareStory(item.storyId, item.deviceName, item.componentDir || undefined);
    },
    [onCompareStory],
  );

  const handleCompareAllForDevice = useCallback(() => {
    const deviceName = selectedDevice === "all" ? undefined : selectedDevice;
    onCompareAllErrors(deviceName);
    onClose();
  }, [selectedDevice, onCompareAllErrors, onClose]);

  const emptyDeviceLabel = selectedDevice === "all" ? "" : ` pour ${getDeviceDisplayName(selectedDevice)}`;

  return (
    <Modal
      isOpen={visible}
      onClose={onClose}
      header={{
        title: { text: "Capture errors" },
        subtitle:
          "Stories dont la dernière capture a échoué. Après une régénération réussie (new, diff ou match), elles quittent la liste.",
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
                Régénérer par device
              </Typo>
              <TabBar
                tabs={deviceTabs}
                selectedTabKey={selectedDevice}
                onSelectedTabKey={key => setSelectedDevice(key as string | "all")}
                compressed
                onBackground
              />
              <Button
                label="Toutes les erreurs"
                leftIcon={{ name: "sync" }}
                color="danger"
                onPress={handleCompareAllForDevice}
                disabled={loading || filteredList.length === 0}
                number={filteredList.length}
              />
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
                {selectedItems.size}/{filteredList.length} sélectionnée{selectedItems.size > 1 ? "s" : ""}
              </Typo>
              <Button
                title={{ text: allSelected ? "Tout désélectionner" : "Tout sélectionner" }}
                color="base"
                onPress={allSelected ? deselectAll : selectAll}
                disabled={filteredList.length === 0 || loading}
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
            <FlatList<GroupedError>
              data={groupedErrors}
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
                    {group.items.map(errorItem => (
                      <Box key={errorItemKey(errorItem)}>
                        <CaptureErrorRow
                          item={errorItem}
                          selected={selectedItems.has(errorItemKey(errorItem))}
                          onSelect={toggleItem}
                          onRetry={handleRetrySingle}
                          disabled={loading}
                        />
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              ListEmptyComponent={
                <EndOfList
                  nbItem={groupedErrors.length}
                  emptyText={`Aucune erreur de capture${emptyDeviceLabel}`}
                />
              }
            />
          ) : (
            <FlatList<CaptureErrorItem>
              data={filteredList}
              contentContainerStyle={{ flex: 1, gap: spacing.xs, paddingBottom: 50 }}
              keyExtractor={errorItemKey}
              showsVerticalScrollIndicator
              renderItem={({ item }) => (
                <CaptureErrorRow
                  item={item}
                  selected={selectedItems.has(errorItemKey(item))}
                  onSelect={toggleItem}
                  onRetry={handleRetrySingle}
                  disabled={loading}
                />
              )}
              ListEmptyComponent={
                <EndOfList
                  nbItem={filteredList.length}
                  emptyText={`Aucune erreur de capture${emptyDeviceLabel}`}
                />
              }
            />
          )}
        </Box>
      }
    />
  );
};

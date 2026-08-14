import type { ReactNode } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import { colors, spacing } from "../themes/theme";
import type { MaterialIconName } from "../types/types";

export type TabBarTab<T = string> = {
  key: T;
  title: string;
  icon?: { name: MaterialIconName; fill?: string };
  /** Compteur texte legacy — préférer `badge` (ex. `<Bullet />`). */
  alertTextInfo?: number;
  /** Slot à côté du titre (typiquement un `<Bullet value={…} color={…} />`). */
  badge?: ReactNode;
  disabled?: boolean;
};

export type TabBarProps<T = string> = {
  tabs: TabBarTab<T>[];
  selectedTabKey: T;
  onSelectedTabKey: (key: T) => void;
  compressed?: boolean;
  onBackground?: boolean;
};

export const TabBar = <T = string,>({ tabs, selectedTabKey, onSelectedTabKey }: TabBarProps<T>) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={{ marginVertical: spacing.s }}
  >
    <View style={{ flexDirection: "row", gap: spacing.xs }}>
      {tabs.map(tab => {
        const selected = selectedTabKey === tab.key;
        return (
          <TouchableOpacity
            key={String(tab.key)}
            onPress={() => onSelectedTabKey(tab.key)}
            style={{
              opacity: tab.disabled ? 0.3 : 1,
              paddingVertical: spacing.s,
              paddingHorizontal: spacing.m,
              borderRadius: 8,
              backgroundColor: selected ? colors.newTheme_primary : colors.newTheme_surface,
            }}
            disabled={tab.disabled}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Text
                style={{
                  color: selected ? colors.newTheme_textOnPrimary : colors.newTheme_textOnSurface,
                  fontWeight: "600",
                }}
              >
                {tab.title}
                {tab.badge == null && tab.alertTextInfo != null && tab.alertTextInfo > 0
                  ? ` (${tab.alertTextInfo})`
                  : ""}
              </Text>
              {tab.badge}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  </ScrollView>
);

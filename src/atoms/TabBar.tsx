import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import { colors, spacing } from "../themes/theme";
import type { MaterialIconName } from "../types/types";

import { Bullet } from "./Bullet";

export type TabBarTab<T = string> = {
  key: T;
  title: string;
  icon?: { name: MaterialIconName; fill?: string };
  alertTextInfo?: number;
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
      {tabs.map(tab => (
        <TouchableOpacity
          key={String(tab.key)}
          onPress={() => onSelectedTabKey(tab.key)}
          style={{
            paddingVertical: spacing.s,
            paddingHorizontal: spacing.m,
            borderRadius: 8,
            backgroundColor: selectedTabKey === tab.key ? colors.newTheme_primary : colors.newTheme_surface,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.s,
          }}
        >
          <Text
            style={{
              color: selectedTabKey === tab.key ? colors.newTheme_textOnPrimary : colors.newTheme_textOnSurface,
              fontWeight: "600",
            }}
          >
            {tab.title}
          </Text>
          {!!tab.alertTextInfo && (
            <Bullet
              value={tab.alertTextInfo}
              color="newTheme_textOnPrimary"
              textColor="newTheme_textOnSurface"
            />
          )}
        </TouchableOpacity>
      ))}
    </View>
  </ScrollView>
);

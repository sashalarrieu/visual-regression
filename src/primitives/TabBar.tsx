import React from "react";
import { ScrollView, TouchableOpacity, Text, View } from "react-native";
import { spacing, colors } from "../theme";

export type TabBarTab<T = string> = {
  key: T;
  title: string;
  icon?: { name: string; fill?: string };
  alertTextInfo?: number;
};

export type TabBarProps<T = string> = {
  tabs: TabBarTab<T>[];
  selectedTabKey: T;
  onSelectedTabKey: (key: T) => void;
  compressed?: boolean;
  onBackground?: boolean;
};

export function TabBar<T = string>({ tabs, selectedTabKey, onSelectedTabKey }: TabBarProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.s }}>
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={String(tab.key)}
            onPress={() => onSelectedTabKey(tab.key)}
            style={{
              paddingVertical: spacing.s,
              paddingHorizontal: spacing.m,
              borderRadius: 8,
              backgroundColor: selectedTabKey === tab.key ? colors.newTheme_primary : colors.newTheme_surface,
            }}
          >
            <Text
              style={{
                color: selectedTabKey === tab.key ? colors.newTheme_textOnPrimary : colors.newTheme_textOnSurface,
                fontWeight: "600",
              }}
            >
              {tab.title}
              {tab.alertTextInfo != null && tab.alertTextInfo > 0 ? ` (${tab.alertTextInfo})` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

import type { ReactNode } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import { colors, spacing, type ColorKey } from "../themes/theme";
import type { MaterialIconName } from "../types/types";

import { Bullet, type BulletProps } from "./Bullet";
import { Icon } from "./Icon";

export type TabBarTab<T = string> = {
  key: T;
  title: string;
  /** Texte compact (mode `compressed`) — ignoré si une icône est fournie. */
  shortTitle?: string;
  icon?: { name: MaterialIconName; fill?: string };
  /** Icône custom (ex. logo Storybook). `color` suit l’état selected. */
  renderIcon?: (props: { color: string; selected: boolean }) => ReactNode;
  /** Compteur texte legacy — préférer `bullet`. */
  alertTextInfo?: number;
  /** Compteur à côté du titre. En selected, `color` est forcé à `newTheme_background`. */
  bullet?: BulletProps;
  disabled?: boolean;
};

export type TabBarProps<T = string> = {
  tabs: TabBarTab<T>[];
  selectedTabKey: T;
  onSelectedTabKey: (key: T) => void;
  /** Pastille + icône ou texte court ; le `title` n’est affiché qu’hors compressed. */
  compressed?: boolean;
  onBackground?: boolean;
};

const isColorKey = (value: string): value is ColorKey => value in colors;

export const TabBar = <T = string,>({
  tabs,
  selectedTabKey,
  onSelectedTabKey,
  compressed = false,
  onBackground = true,
}: TabBarProps<T>) => {
  const unselectedBg = onBackground ? colors.newTheme_surface : colors.newTheme_background;

  const row = (
    <View style={{ flexDirection: "row", gap: spacing.xs, flex: compressed ? 1 : undefined }}>
      {tabs.map(tab => {
        const selected = selectedTabKey === tab.key;
        const computedCompressed = compressed && !selected;
        const contentColor = selected ? colors.newTheme_textOnPrimary : colors.newTheme_textOnSurface;
        const iconFill: ColorKey = selected
          ? "newTheme_textOnPrimary"
          : tab.icon?.fill && isColorKey(tab.icon.fill)
            ? tab.icon.fill
            : "newTheme_textOnSurface";
        const hasIcon = Boolean(tab.renderIcon || tab.icon);
        const label = computedCompressed ? (hasIcon ? undefined : (tab.shortTitle ?? tab.title)) : tab.title;
        const legacyCount =
          tab.bullet == null && tab.alertTextInfo != null && tab.alertTextInfo > 0 ? ` (${tab.alertTextInfo})` : "";

        return (
          <TouchableOpacity
            key={String(tab.key)}
            onPress={() => onSelectedTabKey(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.title}
            accessibilityState={{ selected, disabled: Boolean(tab.disabled) }}
            style={{
              opacity: tab.disabled ? 0.3 : 1,
              paddingVertical: spacing.s,
              paddingHorizontal: computedCompressed ? spacing.s : spacing.m,
              borderRadius: 8,
              backgroundColor: selected ? colors.newTheme_primary : unselectedBg,
              flex: computedCompressed ? 1 : undefined,
              alignItems: "center",
              justifyContent: "center",
            }}
            disabled={tab.disabled}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              {tab.renderIcon?.({ color: contentColor, selected })}
              {tab.icon && !tab.renderIcon && (
                <Icon
                  name={tab.icon.name}
                  fill={iconFill}
                  size="m"
                  style={{ marginRight: 0 }}
                />
              )}
              {label != null && (
                <Text
                  numberOfLines={1}
                  style={{
                    color: contentColor,
                    fontWeight: "600",
                  }}
                >
                  {label}
                  {legacyCount}
                </Text>
              )}
              {tab.bullet != null && (
                <Bullet
                  {...tab.bullet}
                  color={selected ? "newTheme_background" : tab.bullet.color}
                />
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (compressed) {
    return <View style={{ marginVertical: spacing.s }}>{row}</View>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginVertical: spacing.s }}
    >
      {row}
    </ScrollView>
  );
};

import React from "react";
import {
  Modal as RNModal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type ModalProps as RNModalProps,
} from "react-native";

import { Box } from "@atoms/Box";
import { Typo } from "@atoms/Typo";
import { colors, spacing } from "@themes/theme";

export type ModalProps = RNModalProps & {
  isOpen: boolean;
  onClose: () => void;
  header?: {
    title?: { text: string };
    subtitle?: string;
    children?: React.ReactNode;
  };
  content?: React.ReactNode;
  footer?: {
    buttons?: {
      left?: { title?: { text: string }; onPress: () => void; disabled?: boolean; color?: string };
      right?: { title?: { text: string }; onPress: () => void; disabled?: boolean; color?: string };
    };
  };
};

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, header, content, footer }) => {
  return (
    <RNModal
      visible={isOpen}
      onDismiss={onClose}
      transparent
      animationType="fade"
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: spacing.l,
        }}
      >
        <View
          style={{
            backgroundColor: colors.newTheme_background,
            borderRadius: 12,
            maxWidth: 600,
            width: "100%",
            maxHeight: "90%",
          }}
        >
          {header && (
            <Box
              p="m"
              pb="s"
            >
              {header.title && <Typo variant="h2_semiBold">{header.title.text}</Typo>}
              {header.subtitle && (
                <Typo
                  variant="paragraphe_regular"
                  color="newTheme_textLegend"
                  style={{ marginTop: spacing.xs }}
                >
                  {header.subtitle}
                </Typo>
              )}
              {header.children}
            </Box>
          )}
          {content && (
            <ScrollView
              style={{ maxHeight: 400 }}
              contentContainerStyle={{ padding: spacing.m }}
            >
              {content}
            </ScrollView>
          )}
          {footer?.buttons && (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                padding: spacing.m,
                borderTopWidth: 1,
                borderTopColor: colors.newTheme_border,
              }}
            >
              {footer.buttons.left && (
                <TouchableOpacity
                  onPress={footer.buttons.left.onPress}
                  disabled={footer.buttons.left.disabled}
                  style={{ padding: spacing.s }}
                >
                  <Text style={{ color: colors.newTheme_primary }}>{footer.buttons.left.title?.text ?? "Annuler"}</Text>
                </TouchableOpacity>
              )}
              {footer.buttons.right && (
                <TouchableOpacity
                  onPress={footer.buttons.right.onPress}
                  disabled={footer.buttons.right.disabled}
                  style={{
                    padding: spacing.s,
                    backgroundColor: colors.newTheme_primary,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: colors.newTheme_textOnPrimary }}>
                    {footer.buttons.right.title?.text ?? "OK"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </RNModal>
  );
};

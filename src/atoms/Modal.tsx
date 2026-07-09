import React from "react";
import { Modal as RNModal, Pressable, ScrollView, StyleSheet, type ModalProps as RNModalProps } from "react-native";

import { spacing } from "../themes/theme";

import { Box } from "./Box";
import { Button, type ButtonProps } from "./Button";
import { Typo } from "./Typo";

export type ModalButtonProps = {
  title?: { text: string };
  onPress: () => void;
  disabled?: boolean;
  color?: ButtonProps["color"];
};

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
      left?: ModalButtonProps;
      right?: ModalButtonProps;
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
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        p="l"
        style={{
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer la modale"
        />
        <Box
          backgroundColor="newTheme_background"
          borderRadius="base"
          width="100%"
          style={{
            maxWidth: 600,
            maxHeight: "90%",
            zIndex: 1,
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
            <Box
              gap="s"
              p="m"
              borderColor="newTheme_border"
              flexDirection="row"
              justifyContent="space-between"
              style={{
                borderTopWidth: 1,
              }}
            >
              {footer.buttons.left && (
                <Button
                  label={footer.buttons.left.title?.text ?? "Annuler"}
                  onPress={footer.buttons.left.onPress}
                  disabled={footer.buttons.left.disabled}
                  color={footer.buttons.left.color ?? "primary"}
                  flex={1}
                />
              )}
              {footer.buttons.right && (
                <Button
                  label={footer.buttons.right.title?.text ?? "Valider"}
                  onPress={footer.buttons.right.onPress}
                  disabled={footer.buttons.right.disabled}
                  color={footer.buttons.right.color ?? "primary"}
                  flex={1}
                />
              )}
            </Box>
          )}
        </Box>
      </Box>
    </RNModal>
  );
};

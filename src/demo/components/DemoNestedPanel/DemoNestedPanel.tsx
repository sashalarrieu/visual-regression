import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DemoButton } from "../DemoButton/DemoButton";
import { DemoCard } from "../DemoCard/DemoCard";
import { DemoProfileHeader } from "../DemoProfileHeader/DemoProfileHeader";

type DemoNestedPanelProps = {
  /** Slot optionnel pour injecter un composant animé dans le panneau. */
  animatedSlot?: ReactNode;
  variant?: "static" | "with-animation";
};

/**
 * Panneau imbriqué : ProfileHeader + Card + boutons.
 * Sans `animatedSlot` → 100 % statique. Avec slot → parent statique + enfant animé.
 */
export const DemoNestedPanel = ({ animatedSlot, variant = "static" }: DemoNestedPanelProps) => (
  <View style={styles.panel}>
    <Text style={styles.badge}>{variant === "static" ? "Imbriqué · statique" : "Imbriqué · enfant animé"}</Text>
    <DemoProfileHeader
      name="Samira K."
      role="Lead Design"
      status="online"
    />
    <DemoCard
      badge={animatedSlot ? "LIVE" : "STATIC"}
      description="Composition de plusieurs composants demo pour tester le graphe de dépendances VR."
      highlighted={Boolean(animatedSlot)}
      title="Panneau composite"
    />
    {animatedSlot ? <View style={styles.slot}>{animatedSlot}</View> : null}
    <View style={styles.actions}>
      <DemoButton
        label="Valider"
        variant="primary"
      />
      <DemoButton
        label="Annuler"
        variant="secondary"
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  badge: {
    alignSelf: "center",
    backgroundColor: "#e0e7ff",
    borderRadius: 999,
    color: "#3730a3",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  panel: {
    alignItems: "stretch",
    gap: 16,
    maxWidth: 400,
    padding: 8,
    width: "100%",
  },
  slot: {
    alignItems: "center",
  },
});

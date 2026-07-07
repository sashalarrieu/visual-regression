import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DemoButton } from "../DemoButton/DemoButton";

/** Panneau avec overlay modal — ouverture via play() pour tester les captures tardives. */
export const DemoPlayModal = () => {
  const [open, setOpen] = useState(false);

  return (
    <View
      style={styles.root}
      testID="demo-play-modal"
    >
      <Text style={styles.badge}>Play · modal</Text>
      <DemoButton
        label="Ouvrir le détail"
        variant="primary"
        onPress={() => setOpen(true)}
      />
      <Text style={styles.hint}>{open ? "Modal ouverte — layout élargi" : "Modal fermée — layout compact"}</Text>

      {open ? (
        <View
          accessibilityLabel="Modal détail produit"
          style={styles.modal}
        >
          <Text style={styles.modalTitle}>Détail produit</Text>
          <Text style={styles.modalBody}>
            Contenu révélé après interaction play(). La VR doit attendre la fin de play() ou figer cet état.
          </Text>
          <DemoButton
            label="Fermer"
            variant="secondary"
            onPress={() => setOpen(false)}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: "center",
    backgroundColor: "#ede9fe",
    borderRadius: 999,
    color: "#5b21b6",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  hint: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
  },
  modal: {
    backgroundColor: "#ffffff",
    borderColor: "#7c3aed",
    borderRadius: 16,
    borderWidth: 2,
    gap: 12,
    padding: 20,
    width: "100%",
  },
  modalBody: {
    color: "#4b5563",
    fontSize: 15,
    lineHeight: 22,
  },
  modalTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
  root: {
    alignItems: "center",
    gap: 16,
    maxWidth: 400,
    padding: 16,
    width: "100%",
  },
});

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DemoButton } from "../DemoButton/DemoButton";

type DemoPlayCounterProps = {
  initialCount?: number;
};

/** Compteur contrôlé par boutons — cible typique pour stories `play()`. */
export const DemoPlayCounter = ({ initialCount = 0 }: DemoPlayCounterProps) => {
  const [count, setCount] = useState(initialCount);

  return (
    <View
      style={styles.root}
      testID="demo-play-counter"
    >
      <Text style={styles.badge}>Play · état dynamique</Text>
      <Text
        accessibilityLabel={`Compteur ${count}`}
        style={styles.count}
      >
        {count}
      </Text>
      <Text style={styles.hint}>Le screenshot VR dépend du moment où play() termine.</Text>
      <View style={styles.row}>
        <DemoButton
          label="−"
          variant="secondary"
          onPress={() => setCount(value => value - 1)}
        />
        <DemoButton
          label="Réinitialiser"
          variant="secondary"
          onPress={() => setCount(initialCount)}
        />
        <DemoButton
          label="+"
          variant="primary"
          onPress={() => setCount(value => value + 1)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: "center",
    backgroundColor: "#fef3c7",
    borderRadius: 999,
    color: "#92400e",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  count: {
    color: "#111827",
    fontSize: 48,
    fontWeight: "800",
    textAlign: "center",
  },
  hint: {
    color: "#6b7280",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  root: {
    alignItems: "center",
    gap: 16,
    maxWidth: 360,
    padding: 16,
    width: "100%",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
});

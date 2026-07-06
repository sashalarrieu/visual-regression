import { StyleSheet, Text, View } from "react-native";

/** Boîte 100 % statique — baseline VR sans animation. */
export const DemoStaticBox = () => (
  <View style={styles.box}>
    <Text style={styles.label}>Statique</Text>
    <Text style={styles.hint}>Aucune animation</Text>
  </View>
);

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderColor: "#d1d5db",
    borderRadius: 12,
    borderWidth: 2,
    gap: 4,
    justifyContent: "center",
    minHeight: 100,
    minWidth: 200,
    padding: 24,
  },
  hint: {
    color: "#6b7280",
    fontSize: 13,
  },
  label: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "700",
  },
});

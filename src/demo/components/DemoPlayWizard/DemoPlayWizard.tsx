import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DemoButton } from "../DemoButton/DemoButton";

const STEPS = [
  { id: 1, title: "Étape 1", body: "Choisissez une option pour continuer." },
  { id: 2, title: "Étape 2", body: "Confirmez vos préférences." },
  { id: 3, title: "Terminé", body: "Assistant complété — état final pour la VR." },
] as const;

/** Assistant multi-étapes — play() enchaîne les clics « Suivant ». */
export const DemoPlayWizard = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex >= STEPS.length - 1;

  return (
    <View
      style={styles.root}
      testID="demo-play-wizard"
    >
      <Text style={styles.badge}>
        Play · wizard {step.id}/{STEPS.length}
      </Text>
      <View style={styles.card}>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
      </View>
      <View style={styles.progress}>
        {STEPS.map((item, index) => (
          <View
            key={item.id}
            style={[styles.dot, index <= stepIndex && styles.dotActive]}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <DemoButton
          disabled={stepIndex === 0}
          label="Précédent"
          variant="secondary"
          onPress={() => setStepIndex(index => Math.max(0, index - 1))}
        />
        <DemoButton
          disabled={isLast}
          label={isLast ? "Fin" : "Suivant"}
          variant="primary"
          onPress={() => setStepIndex(index => Math.min(STEPS.length - 1, index + 1))}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  badge: {
    alignSelf: "center",
    backgroundColor: "#d1fae5",
    borderRadius: 999,
    color: "#065f46",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  body: {
    color: "#4b5563",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 20,
    width: "100%",
  },
  dot: {
    backgroundColor: "#d1d5db",
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  dotActive: {
    backgroundColor: "#059669",
  },
  progress: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  root: {
    alignItems: "center",
    gap: 16,
    maxWidth: 400,
    padding: 16,
    width: "100%",
  },
  title: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
});

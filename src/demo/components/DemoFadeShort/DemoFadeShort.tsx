import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const CYCLE_MS = 300;

/** Pulsation d'opacité courte (300 ms) — animation simple / rapide. */
export const DemoFadeShort = () => {
  const opacity = useSharedValue(1);

  useEffect(() => {
    const half = CYCLE_MS / 2;
    opacity.value = withRepeat(
      withSequence(withTiming(0.35, { duration: half }), withTiming(1, { duration: half })),
      -1,
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.box, animatedStyle]}>
      <Text style={styles.label}>Fade court</Text>
      <Text style={styles.hint}>{CYCLE_MS} ms / cycle</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: "#dbeafe",
    borderColor: "#2563eb",
    borderRadius: 12,
    borderWidth: 2,
    gap: 4,
    justifyContent: "center",
    minHeight: 100,
    minWidth: 200,
    padding: 24,
  },
  hint: {
    color: "#1d4ed8",
    fontSize: 13,
  },
  label: {
    color: "#1e3a8a",
    fontSize: 18,
    fontWeight: "700",
  },
});

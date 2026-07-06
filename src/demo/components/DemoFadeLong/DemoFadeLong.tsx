import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const CYCLE_MS = 2000;

/** Pulsation d'opacité longue (2 s) — risque de flake si capture trop tôt. */
export const DemoFadeLong = () => {
  const opacity = useSharedValue(1);

  useEffect(() => {
    const half = CYCLE_MS / 2;
    opacity.value = withRepeat(
      withSequence(withTiming(0.25, { duration: half }), withTiming(1, { duration: half })),
      -1,
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.box, animatedStyle]}>
      <Text style={styles.label}>Fade long</Text>
      <Text style={styles.hint}>{CYCLE_MS / 1000}s / cycle</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: "#fef3c7",
    borderColor: "#d97706",
    borderRadius: 12,
    borderWidth: 2,
    gap: 4,
    justifyContent: "center",
    minHeight: 100,
    minWidth: 200,
    padding: 24,
  },
  hint: {
    color: "#b45309",
    fontSize: 13,
  },
  label: {
    color: "#92400e",
    fontSize: 18,
    fontWeight: "700",
  },
});

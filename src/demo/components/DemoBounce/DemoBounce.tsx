import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const CYCLE_MS = 800;

/** Scale bounce — animation simple mais non triviale (ease in/out). */
export const DemoBounce = () => {
  const scale = useSharedValue(1);

  useEffect(() => {
    const half = CYCLE_MS / 2;
    scale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: half, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: half, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.box, animatedStyle]}>
      <Text style={styles.label}>Bounce</Text>
      <Text style={styles.hint}>Scale {CYCLE_MS} ms</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: "#dcfce7",
    borderColor: "#16a34a",
    borderRadius: 12,
    borderWidth: 2,
    gap: 4,
    justifyContent: "center",
    minHeight: 100,
    minWidth: 200,
    padding: 24,
  },
  hint: {
    color: "#15803d",
    fontSize: 13,
  },
  label: {
    color: "#14532d",
    fontSize: 18,
    fontWeight: "700",
  },
});

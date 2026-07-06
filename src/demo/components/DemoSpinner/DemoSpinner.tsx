import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const ROTATION_MS = 1200;

type OrbitDotProps = {
  angleOffset: number;
  rotation: SharedValue<number>;
  color: string;
};

const OrbitDot = ({ angleOffset, rotation, color }: OrbitDotProps) => {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value + angleOffset}deg` }, { translateY: -28 }],
  }));

  return (
    <Animated.View style={[styles.orbitArm, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </Animated.View>
  );
};

/** Spinner multi-éléments (anneau + 3 orbites déphasées) — animation complexe. */
export const DemoSpinner = () => {
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: ROTATION_MS, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withTiming(0.6, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse, rotation]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
    opacity: pulse.value,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.spinnerArea}>
        <Animated.View style={[styles.ring, ringStyle]} />
        <OrbitDot
          angleOffset={0}
          color="#2563eb"
          rotation={rotation}
        />
        <OrbitDot
          angleOffset={120}
          color="#7c3aed"
          rotation={rotation}
        />
        <OrbitDot
          angleOffset={240}
          color="#db2777"
          rotation={rotation}
        />
        <View style={styles.core}>
          <Text style={styles.coreText}>VR</Text>
        </View>
      </View>
      <Text style={styles.caption}>Spinner complexe</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  caption: {
    color: "#4b5563",
    fontSize: 14,
    fontWeight: "600",
  },
  container: {
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  core: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    position: "absolute",
    width: 32,
  },
  coreText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  dot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  orbitArm: {
    alignItems: "center",
    height: 72,
    justifyContent: "flex-start",
    position: "absolute",
    width: 72,
  },
  ring: {
    borderColor: "#93c5fd",
    borderRadius: 999,
    borderTopColor: "#2563eb",
    borderWidth: 3,
    height: 72,
    position: "absolute",
    width: 72,
  },
  spinnerArea: {
    alignItems: "center",
    height: 80,
    justifyContent: "center",
    width: 80,
  },
});

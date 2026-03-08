import React, { useEffect, useMemo, useState } from "react";
import { LayoutRectangle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Box } from "../primitives/Box";

const PARTICLE_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B739", "#52BE80",
];
const NUM_PARTICLES = 100;

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  duration: number;
  delay: number;
}

export const AnimatedLoader = () => {
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const particles: Particle[] = useMemo(() => {
    if (!layout) return [];
    return Array.from({ length: NUM_PARTICLES }, (_, i) => ({
      id: i,
      x: Math.random() * layout.width,
      y: Math.random() * layout.height,
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
      size: 4 + Math.random() * 6,
      duration: 2000 + Math.random() * 3000,
      delay: Math.random() * 1000,
    }));
  }, [layout]);

  return (
    <Box position="absolute" top={0} left={0} right={0} bottom={0}>
      <Box
        flex={1}
        minHeight={300}
        width="100%"
        position="relative"
        overflow="hidden"
        onLayout={e => {
          const newLayout = e.nativeEvent.layout;
          if (newLayout.width > 0 && newLayout.height > 0) setLayout(newLayout);
        }}
      >
        {layout && layout.width > 0 && layout.height > 0 &&
          particles.map(p => <ParticleComponent key={p.id} particle={p} />)}
      </Box>
    </Box>
  );
};

const ParticleComponent = ({ particle }: { particle: Particle }) => {
  const translateY = useSharedValue(particle.y);
  const translateX = useSharedValue(particle.x);
  const opacity = useSharedValue(0.3 + Math.random() * 0.7);
  const scale = useSharedValue(0.5 + Math.random() * 0.5);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withDelay(particle.delay, withTiming(particle.y - 50 - Math.random() * 100, { duration: particle.duration, easing: Easing.inOut(Easing.ease) })),
        withTiming(particle.y + 50 + Math.random() * 100, { duration: particle.duration, easing: Easing.inOut(Easing.ease) }),
      ), -1, true
    );
    translateX.value = withRepeat(
      withSequence(
        withDelay(particle.delay, withTiming(particle.x - 20 - Math.random() * 40, { duration: particle.duration * 1.3, easing: Easing.inOut(Easing.ease) })),
        withTiming(particle.x + 20 + Math.random() * 40, { duration: particle.duration * 1.3, easing: Easing.inOut(Easing.ease) }),
      ), -1, true
    );
    opacity.value = withRepeat(
      withSequence(
        withDelay(particle.delay, withTiming(0.8, { duration: particle.duration / 2 })),
        withTiming(0.3, { duration: particle.duration / 2 }),
      ), -1, true
    );
    scale.value = withRepeat(
      withSequence(
        withDelay(particle.delay, withTiming(1, { duration: particle.duration / 2 })),
        withTiming(0.7, { duration: particle.duration / 2 }),
      ), -1, true
    );
  }, [particle, translateY, translateX, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{ position: "absolute", width: particle.size, height: particle.size }, animatedStyle]}>
      <Svg width={particle.size} height={particle.size} viewBox="0 0 10 10">
        <Circle cx={5} cy={5} r={4} fill={particle.color} />
      </Svg>
    </Animated.View>
  );
};

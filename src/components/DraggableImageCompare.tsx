import React, { useEffect, useState } from "react";
import { Image, PanResponder, type LayoutChangeEvent } from "react-native";
import { Box } from "../primitives/Box";
import { colors } from "../theme";

const CONTAINER_BORDER_WIDTH = 1;
const HITBOX_BORDER = 100;
const TOTAL_CONTAINER_BORDER_WIDTH = CONTAINER_BORDER_WIDTH * 2;
const SEPARATOR_CONTAINER_OFFSET = TOTAL_CONTAINER_BORDER_WIDTH / 2 + 1;

type ImageCompareProps = {
  leftImage?: string;
  rightImage?: string;
  separatorWidth?: number;
};

export function DraggableImageCompare({
  leftImage,
  rightImage,
  separatorWidth = 2,
}: ImageCompareProps) {
  const [separatorX, setSeparatorX] = useState(500);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [leftDims, setLeftDims] = useState<{ w: number; h: number } | null>(null);
  const [rightDims, setRightDims] = useState<{ w: number; h: number } | null>(null);

  const fetchImageSize = (uri: string, setDims: (d: { w: number; h: number }) => void) => {
    Image.getSize(uri, (w, h) => setDims({ w, h }), () => console.warn("Impossible de charger l'image", uri));
  };

  useEffect(() => {
    if (leftImage) {
      setLeftDims(null);
      fetchImageSize(leftImage, setLeftDims);
    } else setLeftDims(null);
  }, [leftImage]);

  useEffect(() => {
    if (rightImage) {
      setRightDims(null);
      fetchImageSize(rightImage, setRightDims);
    } else setRightDims(null);
  }, [rightImage]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      const newX = Math.max(
        -SEPARATOR_CONTAINER_OFFSET,
        Math.min(
          containerWidth + SEPARATOR_CONTAINER_OFFSET - separatorWidth,
          gestureState.moveX - 318 + SEPARATOR_CONTAINER_OFFSET,
        ),
      );
      setSeparatorX(newX);
    },
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerWidth(width);
    setContainerHeight(height);
    setSeparatorX(width / 2);
  };

  let displayHeight = containerHeight;
  let leftScaledWidth = leftDims ? (leftDims.w / leftDims.h) * displayHeight : 0;
  let rightScaledWidth = rightDims ? (rightDims.w / rightDims.h) * displayHeight : 0;
  let containerScaledHeight = containerHeight;

  const maxWidth = Math.max(leftScaledWidth, rightScaledWidth);
  if (maxWidth > containerWidth) {
    const scale = containerWidth / maxWidth;
    displayHeight = displayHeight * scale;
    leftScaledWidth = leftDims ? (leftDims.w / leftDims.h) * displayHeight : 0;
    rightScaledWidth = rightDims ? (rightDims.w / rightDims.h) * displayHeight : 0;
    const leftScaledHeight = leftDims ? (leftScaledWidth * leftDims.h) / leftDims.w : 0;
    const rightScaledHeight = rightDims ? (rightScaledWidth * rightDims.h) / rightDims.w : 0;
    containerScaledHeight = Math.max(leftScaledHeight, rightScaledHeight);
  }

  const leftOffset = containerWidth / 2 - leftScaledWidth / 2;
  const rightOffset = containerWidth / 2 - rightScaledWidth / 2;
  const topOffset = containerHeight / 2 - containerScaledHeight / 2;

  return (
    <Box
      flex={1}
      position="relative"
      justifyContent="center"
      backgroundColor="newTheme_neutral"
      borderRadius="base"
      onLayout={onLayout}
    >
      {rightImage && (
        <Image
          key={rightImage}
          source={{ uri: rightImage }}
          style={{
            position: "absolute",
            top: topOffset,
            left: rightOffset,
            height: containerScaledHeight,
            width: rightScaledWidth - TOTAL_CONTAINER_BORDER_WIDTH,
          }}
        />
      )}
      {leftImage && (
        <Box
          overflow="hidden"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          position="absolute"
          top={0}
          left={0}
          height={containerHeight - TOTAL_CONTAINER_BORDER_WIDTH}
          style={{ width: Math.min(separatorX, containerWidth - SEPARATOR_CONTAINER_OFFSET) } as any}
        >
          <Image
            key={leftImage}
            source={{ uri: leftImage }}
            style={{
              position: "absolute",
              top: topOffset,
              left: leftOffset,
              height: containerScaledHeight,
              width: leftScaledWidth - TOTAL_CONTAINER_BORDER_WIDTH,
            }}
          />
        </Box>
      )}
      <Box
        {...(panResponder.panHandlers as any)}
        position="absolute"
        top={0}
        bottom={0}
        zIndex={10}
        style={{
          left: separatorX - separatorWidth / 2 - HITBOX_BORDER / 2,
          width: HITBOX_BORDER,
          cursor: "ew-resize",
        } as any}
      >
        <Box
          flex={1}
          style={{ left: HITBOX_BORDER / 2, width: separatorWidth, backgroundColor: colors.newTheme_danger } as any}
        />
      </Box>
    </Box>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, type LayoutChangeEvent, type ViewStyle } from "react-native";

import { Box } from "../atoms/Box";
import { colors } from "../themes/theme";
import {
  clampSplitPaneWidth,
  DEFAULT_SPLIT_LEFT_WIDTH,
  DEFAULT_SPLIT_MIN_LEFT_WIDTH,
  DEFAULT_SPLIT_MIN_RIGHT_WIDTH,
} from "../utils/split-pane";

const HANDLE_HEIGHT_PERCENTAGE = 98;
const HANDLE_HITBOX = 12;
const HANDLE_LINE_WIDTH = 1;
const DOUBLE_CLICK_DELAY_MS = 500;
const DRAG_THRESHOLD_PX = 4;

export type DraggableSplitViewProps = {
  left: ReactNode;
  right: ReactNode;
  initialLeftWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
};

export const DraggableSplitView = ({
  left,
  right,
  initialLeftWidth = DEFAULT_SPLIT_LEFT_WIDTH,
  minLeftWidth = DEFAULT_SPLIT_MIN_LEFT_WIDTH,
  minRightWidth = DEFAULT_SPLIT_MIN_RIGHT_WIDTH,
}: DraggableSplitViewProps) => {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [handleHovered, setHandleHovered] = useState(false);

  const leftWidthRef = useRef(leftWidth);
  const containerWidthRef = useRef(containerWidth);
  const minLeftWidthRef = useRef(minLeftWidth);
  const minRightWidthRef = useRef(minRightWidth);
  const dragStartWidthRef = useRef(leftWidth);
  const draggingRef = useRef(false);
  const lastTapAtRef = useRef(0);
  const initialLeftWidthRef = useRef(initialLeftWidth);

  leftWidthRef.current = leftWidth;
  containerWidthRef.current = containerWidth;
  minLeftWidthRef.current = minLeftWidth;
  minRightWidthRef.current = minRightWidth;
  initialLeftWidthRef.current = initialLeftWidth;

  const displayedLeftWidth = clampSplitPaneWidth(leftWidth, containerWidth, minLeftWidth, minRightWidth);
  const handleHighlighted = dragging || handleHovered;

  const applyWidth = (next: number) => {
    const clamped = clampSplitPaneWidth(
      next,
      containerWidthRef.current,
      minLeftWidthRef.current,
      minRightWidthRef.current,
    );
    setLeftWidth(prev => (prev === clamped ? prev : clamped));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          draggingRef.current = false;
          dragStartWidthRef.current = clampSplitPaneWidth(
            leftWidthRef.current,
            containerWidthRef.current,
            minLeftWidthRef.current,
            minRightWidthRef.current,
          );
        },
        onPanResponderMove: (_, gesture) => {
          if (!draggingRef.current) {
            if (Math.abs(gesture.dx) < DRAG_THRESHOLD_PX) return;
            draggingRef.current = true;
            setDragging(true);
          }
          applyWidth(dragStartWidthRef.current + gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          const wasDragging = draggingRef.current;
          draggingRef.current = false;
          setDragging(false);
          if (wasDragging || Math.abs(gesture.dx) >= DRAG_THRESHOLD_PX) {
            lastTapAtRef.current = 0;
            return;
          }
          const now = Date.now();
          if (lastTapAtRef.current > 0 && now - lastTapAtRef.current <= DOUBLE_CLICK_DELAY_MS) {
            lastTapAtRef.current = 0;
            applyWidth(initialLeftWidthRef.current);
            return;
          }
          lastTapAtRef.current = now;
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false;
          lastTapAtRef.current = 0;
          setDragging(false);
        },
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setContainerWidth(prev => (prev === width ? prev : width));
  };

  useEffect(() => {
    if (typeof document === "undefined" || !dragging) return;
    const { body } = document;
    const previousUserSelect = body.style.userSelect;
    const previousCursor = body.style.cursor;
    body.style.userSelect = "none";
    body.style.cursor = "ew-resize";
    return () => {
      body.style.userSelect = previousUserSelect;
      body.style.cursor = previousCursor;
    };
  }, [dragging]);

  return (
    <Box
      flex={1}
      flexDirection="row"
      backgroundColor="newTheme_background"
      position="relative"
      onLayout={onLayout}
    >
      <Box
        width={displayedLeftWidth}
        height="100%"
        overflow="hidden"
        flexShrink={0}
        testID="vr-split-left"
      >
        {left}
      </Box>
      <Box
        {...(panResponder.panHandlers as Record<string, unknown>)}
        flexShrink={0}
        zIndex={10}
        alignItems="center"
        testID="vr-split-handle"
        accessibilityRole="adjustable"
        accessibilityLabel="Redimensionner le panneau"
        style={
          {
            width: HANDLE_HITBOX,
            marginHorizontal: -(HANDLE_HITBOX - HANDLE_LINE_WIDTH) / 2,
            paddingTop: `${(100 - HANDLE_HEIGHT_PERCENTAGE) / 2}%`,
            height: `${HANDLE_HEIGHT_PERCENTAGE}%`,
            cursor: "ew-resize",
            userSelect: "none",
          } as unknown as ViewStyle
        }
        {...({
          onMouseEnter: () => setHandleHovered(true),
          onMouseLeave: () => setHandleHovered(false),
        } as Record<string, unknown>)}
      >
        <Box
          flex={1}
          width={handleHighlighted ? 2 : HANDLE_LINE_WIDTH}
          style={{
            backgroundColor: handleHighlighted ? colors.newTheme_base : colors.newTheme_border,
          }}
        />
      </Box>
      <Box
        flex={1}
        overflow="hidden"
        style={{ minWidth: 0 }}
      >
        {right}
      </Box>
    </Box>
  );
};

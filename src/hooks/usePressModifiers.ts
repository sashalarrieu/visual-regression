import { useEffect, useRef } from "react";

import { emptyPressModifiers, modifiersFromKeyboardEvent, type PressModifiers } from "../utils/press-modifiers";

export type { PressModifiers };

/**
 * Suit Maj / Alt / Ctrl / Meta via le clavier.
 * Plus fiable que `nativeEvent.shiftKey` sur React Native Web (`onPress` ne transmet pas toujours les modifiers).
 */
export const usePressModifiers = (): { current: PressModifiers } => {
  const ref = useRef<PressModifiers>(emptyPressModifiers());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = (event: KeyboardEvent) => {
      ref.current = modifiersFromKeyboardEvent(event);
    };
    const reset = () => {
      ref.current = emptyPressModifiers();
    };

    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return ref;
};

export type PressModifiers = {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};

export const emptyPressModifiers = (): PressModifiers => ({
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
});

const isAltKeyIdentity = (event: { key?: string; code?: string }): boolean =>
  event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";

/** Option (macOS) = Alt. Safari peut laisser `altKey` à false sur le keydown de la touche elle-même. */
export const modifiersFromKeyboardEvent = (event: KeyboardEvent): PressModifiers => {
  const isAltKey = isAltKeyIdentity(event);
  const altKey = event.type === "keyup" && isAltKey ? false : event.altKey || (event.type === "keydown" && isAltKey);

  return {
    shiftKey: event.shiftKey,
    altKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
  };
};

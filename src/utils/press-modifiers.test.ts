import { describe, expect, it } from "vitest";

import { modifiersFromKeyboardEvent } from "./press-modifiers";

describe("modifiersFromKeyboardEvent", () => {
  const keyEvent = (partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "type">): KeyboardEvent =>
    partial as KeyboardEvent;

  it("traite la touche Option/Alt même si altKey est false (Safari)", () => {
    expect(
      modifiersFromKeyboardEvent(
        keyEvent({
          type: "keydown",
          key: "Alt",
          code: "AltLeft",
          altKey: false,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        }),
      ).altKey,
    ).toBe(true);
    expect(
      modifiersFromKeyboardEvent(
        keyEvent({
          type: "keyup",
          key: "Alt",
          code: "AltLeft",
          altKey: true,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        }),
      ).altKey,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { clampSplitPaneWidth } from "./split-pane";

describe("clampSplitPaneWidth", () => {
  it("laisse la largeur inchangée tant que le conteneur n’est pas mesuré", () => {
    expect(clampSplitPaneWidth(300, 0, 200, 320)).toBe(300);
  });

  it("respecte le minimum gauche et le minimum droit", () => {
    expect(clampSplitPaneWidth(100, 1000, 200, 320)).toBe(200);
    expect(clampSplitPaneWidth(900, 1000, 200, 320)).toBe(680);
    expect(clampSplitPaneWidth(400, 1000, 200, 320)).toBe(400);
  });

  it("ne force plus les minimums si le conteneur est trop étroit", () => {
    expect(clampSplitPaneWidth(300, 400, 200, 320)).toBe(300);
    expect(clampSplitPaneWidth(500, 400, 200, 320)).toBe(400);
    expect(clampSplitPaneWidth(-10, 400, 200, 320)).toBe(0);
  });
});

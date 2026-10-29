import { describe, expect, it } from "vitest";

import { applyClassicScrollbarsInPage, elementOverflows, isScrolledToEnd, overflowDelta } from "./play-helpers";

const box = (partial: {
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  scrollLeft?: number;
  scrollTop?: number;
}) => ({
  scrollWidth: 100,
  clientWidth: 100,
  scrollHeight: 100,
  clientHeight: 100,
  scrollLeft: 0,
  scrollTop: 0,
  ...partial,
});

describe("elementOverflows", () => {
  it("detects horizontal overflow beyond the 2px threshold", () => {
    expect(elementOverflows(box({ scrollWidth: 103, clientWidth: 100 }), "x")).toBe(true);
    expect(elementOverflows(box({ scrollWidth: 102, clientWidth: 100 }), "x")).toBe(false);
  });

  it("detects vertical overflow beyond the 2px threshold", () => {
    expect(elementOverflows(box({ scrollHeight: 103, clientHeight: 100 }), "y")).toBe(true);
    expect(elementOverflows(box({ scrollHeight: 101, clientHeight: 100 }), "y")).toBe(false);
  });
});

describe("isScrolledToEnd", () => {
  it("is true when the remaining scroll is within 2px on x", () => {
    expect(isScrolledToEnd(box({ scrollWidth: 200, clientWidth: 100, scrollLeft: 98 }), "x")).toBe(true);
    expect(isScrolledToEnd(box({ scrollWidth: 200, clientWidth: 100, scrollLeft: 50 }), "x")).toBe(false);
  });

  it("is true when the remaining scroll is within 2px on y", () => {
    expect(isScrolledToEnd(box({ scrollHeight: 200, clientHeight: 100, scrollTop: 100 }), "y")).toBe(true);
    expect(isScrolledToEnd(box({ scrollHeight: 200, clientHeight: 100, scrollTop: 0 }), "y")).toBe(false);
  });
});

describe("overflowDelta", () => {
  it("returns the raw overflow amount", () => {
    expect(overflowDelta(box({ scrollWidth: 250, clientWidth: 100 }), "x")).toBe(150);
    expect(overflowDelta(box({ scrollHeight: 110, clientHeight: 100 }), "y")).toBe(10);
  });
});

describe("applyClassicScrollbarsInPage", () => {
  it("is a no-op without a document", () => {
    expect(() => applyClassicScrollbarsInPage()).not.toThrow();
  });
});

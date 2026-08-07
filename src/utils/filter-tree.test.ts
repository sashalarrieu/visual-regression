import { describe, expect, it } from "vitest";

import type { Node } from "../types/types";

import { filterTree } from "./filter-tree";

const file = (partial: Partial<Node> & Pick<Node, "name" | "path">): Node => ({
  type: "file",
  ...partial,
});

const folder = (
  name: string,
  path: string,
  children: Record<string, Node>,
  counts?: Partial<
    Pick<Node, "countTotal" | "countNew" | "countDiff" | "countBaseline" | "countMissing" | "countIgnored">
  >,
): Node => ({
  type: "folder",
  name,
  path,
  children,
  countTotal: counts?.countTotal,
  countNew: counts?.countNew,
  countDiff: counts?.countDiff,
  countBaseline: counts?.countBaseline,
  countMissing: counts?.countMissing,
  countIgnored: counts?.countIgnored,
});

const sampleRegressionsTree = (): Node =>
  folder(
    "root",
    "",
    {
      Button: folder(
        "Button",
        "Button",
        {
          "primary-desktop": file({
            name: "primary-desktop",
            path: "Button/primary-desktop.png",
            storyId: "demo-button--primary",
            displayName: "Primary",
            storyType: "new",
            deviceName: "desktop",
          }),
          "primary-mobile": file({
            name: "primary-mobile",
            path: "Button/primary-mobile.png",
            storyId: "demo-button--primary",
            displayName: "Primary",
            storyType: "diff",
            deviceName: "mobile",
          }),
        },
        { countTotal: 2, countNew: 1, countDiff: 1 },
      ),
      Card: folder(
        "Card",
        "Card",
        {
          "default-desktop": file({
            name: "default-desktop",
            path: "Card/default-desktop.png",
            storyId: "demo-card--default",
            displayName: "Default",
            storyType: "diff",
            deviceName: "desktop",
          }),
        },
        { countTotal: 1, countNew: 0, countDiff: 1 },
      ),
      Empty: folder("Empty", "Empty", {}, { countTotal: 0 }),
    },
    { countTotal: 3, countNew: 1, countDiff: 2 },
  );

const sampleCatalogTree = (): Node =>
  folder(
    "root",
    "",
    {
      Button: folder(
        "Button",
        "Button",
        {
          baseline: file({
            name: "baseline",
            path: "Button/baseline.png",
            storyId: "demo-button--primary",
            displayName: "Primary",
            storyType: "baseline",
          }),
          missing: file({
            name: "missing",
            path: "Button/missing.png",
            storyId: "demo-button--secondary",
            displayName: "Secondary",
            storyType: "missing",
          }),
          blocked: file({
            name: "blocked",
            path: "Button/blocked.png",
            storyId: "demo-button--ignored",
            displayName: "Ignored Story",
            storyType: "baseline",
            ignored: true,
          }),
          blockedMissing: file({
            name: "blockedMissing",
            path: "Button/blocked-missing.png",
            storyId: "demo-button--ignored-missing",
            displayName: "Ignored Missing",
            storyType: "missing",
            ignored: true,
          }),
        },
        { countTotal: 4, countBaseline: 2, countMissing: 2, countIgnored: 2 },
      ),
    },
    { countTotal: 4, countBaseline: 2, countMissing: 2, countIgnored: 2 },
  );

describe("filterTree", () => {
  it("returns null for null input", () => {
    expect(filterTree(null, { query: "x" })).toBeNull();
  });

  it("returns the same tree when query and statuses are empty", () => {
    const tree = sampleRegressionsTree();
    expect(filterTree(tree, { mode: "regressions" })).toBe(tree);
    expect(filterTree(tree, { query: "  ", statuses: new Set(), mode: "regressions" })).toBe(tree);
  });

  it("filters by displayName (case-insensitive)", () => {
    const result = filterTree(sampleRegressionsTree(), { query: "prim", mode: "regressions" });
    expect(result).not.toBeNull();
    expect(Object.keys(result!.children ?? {})).toEqual(["Button"]);
    expect(Object.keys(result!.children!.Button.children ?? {}).sort()).toEqual(["primary-desktop", "primary-mobile"]);
    expect(result!.countTotal).toBe(2);
    expect(result!.children!.Button.countTotal).toBe(2);
  });

  it("filters by storyId", () => {
    const result = filterTree(sampleRegressionsTree(), {
      query: "demo-card--default",
      mode: "regressions",
    });
    expect(Object.keys(result!.children ?? {})).toEqual(["Card"]);
    expect(result!.countTotal).toBe(1);
  });

  it("filters by path", () => {
    const result = filterTree(sampleRegressionsTree(), {
      query: "card/default",
      mode: "regressions",
    });
    expect(Object.keys(result!.children ?? {})).toEqual(["Card"]);
  });

  it("fuzzy subsequence match on path (typos / abréviations)", () => {
    const tree = folder(
      "src",
      "src/",
      {
        demo: folder(
          "demo",
          "src/demo/",
          {
            components: folder(
              "components",
              "src/demo/components/",
              {
                DemoCard: folder(
                  "DemoCard",
                  "src/demo/components/DemoCard/",
                  {
                    file: file({
                      name: "emo-animaxdcfgstion-fadelong--default",
                      path: "src/demo/components/DemoCard/Screenshots/emo-animaxdcfgstion-fadelong--default.screenshot.png",
                      storyId: "emo-animaxdcfgstion-fadelong--default",
                      displayName: "default",
                      storyType: "baseline",
                    }),
                  },
                  { countTotal: 1 },
                ),
              },
              { countTotal: 1 },
            ),
          },
          { countTotal: 1 },
        ),
      },
      { countTotal: 1 },
    );

    const result = filterTree(tree, {
      query: "demo/compoxdc",
      mode: "orphans",
    });
    expect(result).not.toBeNull();
    expect(result!.countTotal).toBe(1);
  });

  it("hides empty folders after filter", () => {
    const result = filterTree(sampleRegressionsTree(), { query: "primary", mode: "regressions" });
    expect(result!.children?.Empty).toBeUndefined();
    expect(result!.children?.Card).toBeUndefined();
  });

  it("returns null when nothing matches the query", () => {
    expect(filterTree(sampleRegressionsTree(), { query: "zzz-nope", mode: "regressions" })).toBeNull();
  });

  describe("status filter — regressions", () => {
    it("empty statuses shows all files", () => {
      const tree = sampleRegressionsTree();
      const result = filterTree(tree, {
        mode: "regressions",
        statuses: new Set(),
      });
      expect(result).toBe(tree);
    });

    it("filters new only", () => {
      const result = filterTree(sampleRegressionsTree(), {
        mode: "regressions",
        statuses: new Set(["new"]),
      });
      expect(result!.countTotal).toBe(1);
      expect(result!.countNew).toBe(1);
      expect(result!.countDiff).toBe(0);
      expect(Object.keys(result!.children ?? {})).toEqual(["Button"]);
      expect(Object.keys(result!.children!.Button.children ?? {})).toEqual(["primary-desktop"]);
    });

    it("filters diff only", () => {
      const result = filterTree(sampleRegressionsTree(), {
        mode: "regressions",
        statuses: new Set(["diff"]),
      });
      expect(result!.countTotal).toBe(2);
      expect(result!.countDiff).toBe(2);
      expect(result!.countNew).toBe(0);
    });

    it("OR between new and diff chips", () => {
      const result = filterTree(sampleRegressionsTree(), {
        mode: "regressions",
        statuses: new Set(["new", "diff"]),
      });
      expect(result!.countTotal).toBe(3);
    });
  });

  describe("status filter — all-stories", () => {
    it("filters baseline", () => {
      const result = filterTree(sampleCatalogTree(), {
        mode: "all-stories",
        statuses: new Set(["baseline"]),
      });
      expect(result!.countTotal).toBe(2);
      expect(result!.countBaseline).toBe(2);
      expect(result!.countMissing).toBe(0);
    });

    it("filters missing", () => {
      const result = filterTree(sampleCatalogTree(), {
        mode: "all-stories",
        statuses: new Set(["missing"]),
      });
      expect(result!.countTotal).toBe(2);
      expect(result!.countMissing).toBe(2);
    });

    it("filters block via ignored === true", () => {
      const result = filterTree(sampleCatalogTree(), {
        mode: "all-stories",
        statuses: new Set(["block"]),
      });
      expect(result!.countTotal).toBe(2);
      expect(result!.countIgnored).toBe(2);
      const names = Object.keys(result!.children!.Button.children ?? {}).sort();
      expect(names).toEqual(["blocked", "blockedMissing"]);
    });

    it("OR between baseline and block", () => {
      const result = filterTree(sampleCatalogTree(), {
        mode: "all-stories",
        statuses: new Set(["baseline", "block"]),
      });
      // baseline (2) ∪ block (2) = 3 uniques (blocked is in both)
      expect(result!.countTotal).toBe(3);
    });
  });

  describe("search AND status", () => {
    it("combines query and status with AND", () => {
      const result = filterTree(sampleRegressionsTree(), {
        mode: "regressions",
        query: "primary",
        statuses: new Set(["diff"]),
      });
      expect(result!.countTotal).toBe(1);
      expect(Object.keys(result!.children!.Button.children ?? {})).toEqual(["primary-mobile"]);
    });

    it("returns null when query matches but status does not", () => {
      expect(
        filterTree(sampleRegressionsTree(), {
          mode: "regressions",
          query: "card",
          statuses: new Set(["new"]),
        }),
      ).toBeNull();
    });
  });

  describe("orphans mode", () => {
    it("applies search only and ignores statuses", () => {
      const tree = sampleRegressionsTree();
      const withStatuses = filterTree(tree, {
        mode: "orphans",
        statuses: new Set(["new"]),
      });
      expect(withStatuses).toBe(tree);

      const withQuery = filterTree(tree, {
        mode: "orphans",
        query: "card",
        statuses: new Set(["new"]),
      });
      expect(withQuery!.countTotal).toBe(1);
      expect(Object.keys(withQuery!.children ?? {})).toEqual(["Card"]);
    });
  });

  it("accepts statuses as an array", () => {
    const result = filterTree(sampleRegressionsTree(), {
      mode: "regressions",
      statuses: ["new"],
    });
    expect(result!.countTotal).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import type { Node } from "../types/types";

import {
  buildStoriesTreeFromEntries,
  resolvePublicBaselinePath,
  type StorybookIndexEntry,
} from "./vr-server-stories-tree";

const entries = (list: StorybookIndexEntry[]): Record<string, StorybookIndexEntry> =>
  Object.fromEntries(list.map(e => [e.id, e]));

const collectFiles = (node: Node | null): Node[] => {
  if (!node) return [];
  if (node.type === "file") return [node];
  return Object.values(node.children ?? {}).flatMap(collectFiles);
};

describe("buildStoriesTreeFromEntries", () => {
  const publicDir = "/tmp/vr-public/Screenshots";

  it("crée un nœud par story × device avec baseline / missing", () => {
    const baselinePath = resolvePublicBaselinePath(
      publicDir,
      "src/demo/components/DemoButton",
      "desktop-fhd",
      "demo-button--primary",
    );

    const result = buildStoriesTreeFromEntries({
      entries: entries([
        {
          id: "demo-button--primary",
          type: "story",
          importPath: "src/demo/components/DemoButton/DemoButton.stories.tsx",
          tags: [],
        },
        {
          id: "demo-card--default",
          type: "story",
          importPath: "src/demo/components/DemoCard/DemoCard.stories.tsx",
          tags: [],
        },
      ]),
      deviceNames: ["desktop-fhd", "mobile"],
      publicScreenshotsDir: publicDir,
      baselineExists: abs => abs === baselinePath,
      vrServerUrl: "http://localhost:2805",
    });

    expect(result.storyCount).toBe(2);
    const files = collectFiles(result.tree);
    expect(files).toHaveLength(4);

    const primaryDesktop = files.find(f => f.storyId === "demo-button--primary" && f.deviceName === "desktop-fhd");
    expect(primaryDesktop?.storyType).toBe("baseline");
    expect(primaryDesktop?.imageUrls?.original).toContain(
      "Screenshots/src/demo/components/DemoButton/desktop-fhd-demo-button--primary.screenshot.png",
    );

    const primaryMobile = files.find(f => f.storyId === "demo-button--primary" && f.deviceName === "mobile");
    expect(primaryMobile?.storyType).toBe("missing");
    expect(primaryMobile?.imageUrls).toBeUndefined();
  });

  it("marque ignored pour ignore-vr sans force-vr", () => {
    const result = buildStoriesTreeFromEntries({
      entries: entries([
        {
          id: "ignored--story",
          type: "story",
          importPath: "src/a/A.stories.tsx",
          tags: ["ignore-vr"],
        },
        {
          id: "forced--story",
          type: "story",
          importPath: "src/b/B.stories.tsx",
          tags: ["ignore-vr", "force-vr"],
        },
      ]),
      deviceNames: ["desktop-fhd"],
      publicScreenshotsDir: publicDir,
      baselineExists: () => false,
    });

    const files = collectFiles(result.tree);
    expect(files.find(f => f.storyId === "ignored--story")?.ignored).toBe(true);
    expect(files.find(f => f.storyId === "forced--story")?.ignored).toBe(false);
    expect(result.tree?.countIgnored).toBe(1);
    expect(result.tree?.countMissing).toBe(2);
  });

  it("fingerprint stable si structure inchangée, change si baseline apparaît", () => {
    const input = {
      entries: entries([
        {
          id: "demo--x",
          type: "story",
          importPath: "src/demo/X.stories.tsx",
          tags: [],
        },
      ]),
      deviceNames: ["desktop-fhd"],
      publicScreenshotsDir: publicDir,
    };

    const a = buildStoriesTreeFromEntries({ ...input, baselineExists: () => false });
    const b = buildStoriesTreeFromEntries({ ...input, baselineExists: () => false });
    expect(a.fingerprint).toBe(b.fingerprint);

    const c = buildStoriesTreeFromEntries({ ...input, baselineExists: () => true });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("ignore docs et entries sans importPath", () => {
    const result = buildStoriesTreeFromEntries({
      entries: entries([
        { id: "page--docs", type: "docs", importPath: "src/a/A.mdx", tags: [] },
        { id: "story--docs", type: "story", importPath: "src/a/A.stories.tsx", tags: [] },
        { id: "orphan--id", type: "story", tags: [] },
      ]),
      deviceNames: ["desktop-fhd"],
      publicScreenshotsDir: publicDir,
      baselineExists: () => false,
    });

    // story--docs ends with --docs → exclu ; orphan sans importPath → exclu ; page docs → exclu
    expect(result.storyCount).toBe(0);
    expect(result.tree).toBeNull();
  });
});

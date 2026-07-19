import { describe, expect, it } from "vitest";

import { FORCE_VR_TAG, IGNORE_VR_TAG } from "../constants/constants";

import {
  buildStoriesCatalogTree,
  computeCatalogFingerprint,
  isStoryIgnoredForVr,
  resolveBaselineServePath,
  type StorybookIndexEntry,
} from "./vr-stories-catalog";

const devices = [
  { name: "desktop-fhd", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false },
  { name: "iphone16", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true },
];

const story = (partial: Partial<StorybookIndexEntry> & { id: string; importPath: string }): StorybookIndexEntry => ({
  type: "story",
  tags: [],
  ...partial,
});

describe("vr-stories-catalog", () => {
  it("detects ignore-vr without force-vr", () => {
    expect(isStoryIgnoredForVr([IGNORE_VR_TAG])).toBe(true);
    expect(isStoryIgnoredForVr([IGNORE_VR_TAG, FORCE_VR_TAG])).toBe(false);
    expect(isStoryIgnoredForVr([])).toBe(false);
  });

  it("builds one file node per story × device", () => {
    const result = buildStoriesCatalogTree({
      projectRoot: "/tmp/project",
      devices,
      stories: [
        story({ id: "atoms-alert--default", importPath: "./src/atoms/Alert/Alert.stories.tsx" }),
        story({
          id: "atoms-button--primary",
          importPath: "./src/atoms/Button/Button.stories.tsx",
          tags: [IGNORE_VR_TAG],
        }),
      ],
    });

    expect(result.storyCount).toBe(2);
    expect(result.tree).not.toBeNull();

    const files: string[] = [];
    const walk = (node: NonNullable<typeof result.tree>) => {
      if (node.type === "file") {
        files.push(`${node.storyId}|${node.deviceName}|${node.ignored}|${node.storyType}`);
        return;
      }
      Object.values(node.children ?? {}).forEach(walk);
    };
    walk(result.tree!);

    expect(files).toHaveLength(4);
    expect(files.filter(f => f.includes("atoms-button--primary") && f.includes("true"))).toHaveLength(2);
    expect(files.every(f => f.endsWith("|missing"))).toBe(true);
  });

  it("fingerprint is stable when catalog unchanged, changes when story added/removed", () => {
    const storiesA = [story({ id: "a--x", importPath: "./src/a/A.stories.tsx" })];
    const storiesB = [
      story({ id: "a--x", importPath: "./src/a/A.stories.tsx" }),
      story({ id: "b--y", importPath: "./src/b/B.stories.tsx" }),
    ];

    const a1 = buildStoriesCatalogTree({ projectRoot: "/tmp/p", devices, stories: storiesA });
    const a2 = buildStoriesCatalogTree({ projectRoot: "/tmp/p", devices, stories: storiesA });
    const b = buildStoriesCatalogTree({ projectRoot: "/tmp/p", devices, stories: storiesB });

    expect(a1.fingerprint).toBe(a2.fingerprint);
    expect(a1.fingerprint).not.toBe(b.fingerprint);
  });

  it("computeCatalogFingerprint sorts for stability", () => {
    const fp1 = computeCatalogFingerprint([
      { storyId: "b", deviceName: "d1", ignored: false, hasBaseline: false },
      { storyId: "a", deviceName: "d1", ignored: false, hasBaseline: true },
    ]);
    const fp2 = computeCatalogFingerprint([
      { storyId: "a", deviceName: "d1", ignored: false, hasBaseline: true },
      { storyId: "b", deviceName: "d1", ignored: false, hasBaseline: false },
    ]);
    expect(fp1).toBe(fp2);
  });

  it("resolveBaselineServePath blocks traversal", () => {
    expect(resolveBaselineServePath("/tmp/project", "/baselines/../etc/passwd")).toBeNull();
    expect(resolveBaselineServePath("/tmp/project", "/baselines/src/Alert/Screenshots/x.screenshot.png")).toBe(
      "/tmp/project/src/Alert/Screenshots/x.screenshot.png",
    );
  });
});

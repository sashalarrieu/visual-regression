import { describe, expect, it } from "vitest";

import type { Node } from "../types/types";

import { buildOrphansTreeFromScan, collectKnownStoryIds, extractOrphanScreenshotMeta } from "./vr-server-orphans-tree";
import type { StorybookIndexEntry } from "./vr-server-stories-tree";

const collectFiles = (node: Node | null): Node[] => {
  if (!node) return [];
  if (node.type === "file") return [node];
  return Object.values(node.children ?? {}).flatMap(collectFiles);
};

describe("extractOrphanScreenshotMeta", () => {
  const devices = ["desktop-fhd", "mobile"];

  it("parse baseline, new et diff", () => {
    expect(extractOrphanScreenshotMeta("desktop-fhd-foo--bar.screenshot.png", devices)).toEqual({
      deviceName: "desktop-fhd",
      storyId: "foo--bar",
      storyType: "baseline",
    });
    expect(extractOrphanScreenshotMeta("__new__mobile-foo--bar.screenshot.png", devices)).toEqual({
      deviceName: "mobile",
      storyId: "foo--bar",
      storyType: "new",
    });
    expect(extractOrphanScreenshotMeta("__diff__desktop-fhd-foo--bar.screenshot.png", devices)).toEqual({
      deviceName: "desktop-fhd",
      storyId: "foo--bar",
      storyType: "diff",
    });
  });

  it("ignore __temp__", () => {
    expect(extractOrphanScreenshotMeta("__temp__desktop-fhd-foo--bar.screenshot.png", devices)).toBeNull();
  });

  it("parse sans device + variante Finder « copy »", () => {
    expect(extractOrphanScreenshotMeta("emo-animaxdcfgstion-fadelong--default.screenshot.png", devices)).toEqual({
      deviceName: null,
      storyId: "emo-animaxdcfgstion-fadelong--default",
      storyType: "baseline",
    });
    expect(extractOrphanScreenshotMeta("emo-animaxdcfgstion-fadelong--default.screenshot copy.png", devices)).toEqual({
      deviceName: null,
      storyId: "emo-animaxdcfgstion-fadelong--default",
      storyType: "baseline",
    });
    expect(extractOrphanScreenshotMeta("test.screenshot.png", devices)).toEqual({
      deviceName: null,
      storyId: "test",
      storyType: "baseline",
    });
  });
});

describe("collectKnownStoryIds", () => {
  it("ne garde que les stories (pas docs)", () => {
    const entries: Record<string, StorybookIndexEntry> = {
      a: { id: "demo--a", type: "story" },
      b: { id: "demo--docs", type: "docs" },
      c: { id: "page--docs", type: "story" },
      d: { id: "keep--me", type: "story" },
    };
    const ids = collectKnownStoryIds(entries);
    expect(ids.has("demo--a")).toBe(true);
    expect(ids.has("keep--me")).toBe(true);
    expect(ids.has("demo--docs")).toBe(false);
    expect(ids.has("page--docs")).toBe(false);
  });
});

describe("buildOrphansTreeFromScan", () => {
  const devices = ["desktop-fhd", "mobile"];

  it("inclut un fichier dont le storyId est absent de l'index", () => {
    const result = buildOrphansTreeFromScan({
      relativePaths: [
        "src/atoms/Old/desktop-fhd-removed--story.screenshot.png",
        "src/atoms/Old/__new__mobile-removed--story.screenshot.png",
      ],
      knownStoryIds: new Set(["still--there"]),
      deviceNames: devices,
      vrServerUrl: "http://localhost:2805",
    });

    expect(result.countTotal).toBe(2);
    const files = collectFiles(result.tree);
    expect(files).toHaveLength(2);
    expect(files.every(f => f.storyId === "removed--story")).toBe(true);
    expect(files.find(f => f.storyType === "baseline")?.imageUrls?.original).toContain(
      "Screenshots/src/atoms/Old/desktop-fhd-removed--story.screenshot.png",
    );
    expect(files.find(f => f.storyType === "new")?.imageUrls?.new).toContain(
      "Screenshots/src/atoms/Old/__new__mobile-removed--story.screenshot.png",
    );
  });

  it("exclut un fichier dont le storyId est connu", () => {
    const result = buildOrphansTreeFromScan({
      relativePaths: ["src/atoms/Btn/desktop-fhd-btn--primary.screenshot.png"],
      knownStoryIds: new Set(["btn--primary"]),
      deviceNames: devices,
    });

    expect(result.countTotal).toBe(0);
    expect(result.tree).toBeNull();
  });

  it("countTotal === 0 → tree null (pas de tab)", () => {
    const result = buildOrphansTreeFromScan({
      relativePaths: [],
      knownStoryIds: new Set(),
      deviceNames: devices,
    });
    expect(result).toEqual(
      expect.objectContaining({
        tree: null,
        countTotal: 0,
      }),
    );
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprint stable si structure inchangée, change si fichier ajouté", () => {
    const known = new Set<string>();
    const base = {
      knownStoryIds: known,
      deviceNames: devices,
      relativePaths: ["src/a/desktop-fhd-gone--x.screenshot.png"],
    };
    const a = buildOrphansTreeFromScan(base);
    const b = buildOrphansTreeFromScan(base);
    expect(a.fingerprint).toBe(b.fingerprint);

    const c = buildOrphansTreeFromScan({
      ...base,
      relativePaths: ["src/a/desktop-fhd-gone--x.screenshot.png", "src/a/__diff__desktop-fhd-gone--y.screenshot.png"],
    });
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(c.countTotal).toBe(2);
  });

  it("ignore deleted/ et chemins hors arbre src", () => {
    const result = buildOrphansTreeFromScan({
      relativePaths: [
        "deleted/src/a/desktop-fhd-orphan--x.screenshot.png",
        "Screenshots/deleted/src/a/desktop-fhd-orphan--y.screenshot.png",
        "other/desktop-fhd-orphan--z.screenshot.png",
      ],
      knownStoryIds: new Set(),
      deviceNames: devices,
    });
    expect(result.countTotal).toBe(0);
    expect(result.tree).toBeNull();
  });

  it("détecte une baseline co-localisée source (origin source)", () => {
    const result = buildOrphansTreeFromScan({
      entries: [
        {
          relativePath:
            "src/demo/components/DemoFadeLong/Screenshots/ipad-a16-landscape-demo-animaxdcfgstion-fadelong--default.screenshot.png",
          origin: "source",
        },
      ],
      knownStoryIds: new Set(["demo-animation-fadelong--default"]),
      deviceNames: ["ipad-a16-landscape", "desktop-fhd"],
      vrServerUrl: "http://localhost:2805",
    });

    expect(result.countTotal).toBe(1);
    const files = collectFiles(result.tree);
    expect(files).toHaveLength(1);
    expect(files[0].storyId).toBe("demo-animaxdcfgstion-fadelong--default");
    expect(files[0].storyType).toBe("baseline");
    expect(files[0].imagePaths?.original).toBe(
      "src/demo/components/DemoFadeLong/Screenshots/ipad-a16-landscape-demo-animaxdcfgstion-fadelong--default.screenshot.png",
    );
    expect(files[0].imageUrls?.original).toContain(
      "/project-file/src/demo/components/DemoFadeLong/Screenshots/ipad-a16-landscape-demo-animaxdcfgstion-fadelong--default.screenshot.png",
    );
  });

  it("exclut une baseline source dont le storyId est connu", () => {
    const result = buildOrphansTreeFromScan({
      entries: [
        {
          relativePath:
            "src/demo/components/DemoFadeLong/Screenshots/ipad-a16-landscape-demo-animation-fadelong--default.screenshot.png",
          origin: "source",
        },
      ],
      knownStoryIds: new Set(["demo-animation-fadelong--default"]),
      deviceNames: ["ipad-a16-landscape"],
    });
    expect(result.countTotal).toBe(0);
    expect(result.tree).toBeNull();
  });

  it("détecte un screenshot hors dossier Screenshots et une variante Finder copy", () => {
    const result = buildOrphansTreeFromScan({
      entries: [
        {
          relativePath: "src/demo/test.screenshot.png",
          origin: "source",
        },
        {
          relativePath: "src/demo/components/Screenshots/emo-animaxdcfgstion-fadelong--default.screenshot copy.png",
          origin: "source",
        },
      ],
      knownStoryIds: new Set(["demo-animation-fadelong--default"]),
      deviceNames: ["ipad-a16-landscape", "desktop-fhd"],
      vrServerUrl: "http://localhost:2805",
    });

    expect(result.countTotal).toBe(2);
    const files = collectFiles(result.tree);
    const ids = files.map(f => f.storyId).sort();
    expect(ids).toEqual(["emo-animaxdcfgstion-fadelong--default", "test"]);
    expect(files.find(f => f.storyId === "test")?.imageUrls?.original).toContain(
      "/project-file/src/demo/test.screenshot.png",
    );
  });
});

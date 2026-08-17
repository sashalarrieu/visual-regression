import { describe, expect, it } from "vitest";

import type { Node } from "../types/types";

import {
  collectFolderPaths,
  compareNodeTypeForDisplay,
  flattenTreeVisual,
  getVisualChildGroups,
  pathsInVisualRange,
} from "./tree-order";

const file = (name: string, path: string): Node => ({
  type: "file",
  name,
  path,
});

const folder = (name: string, path: string, children: Record<string, Node>): Node => ({
  type: "folder",
  name,
  path,
  children,
});

/** A (stories + SousA) puis B — comme l’exemple d’UI. */
const sampleTree = (): Node =>
  folder("root", "", {
    A: folder("A", "A", {
      SousA: folder("SousA", "A/SousA", {
        storySousA1: file("storySousA1", "A/SousA/storySousA1.png"),
        storySousA2: file("storySousA2", "A/SousA/storySousA2.png"),
      }),
      storyA1: file("storyA1", "A/storyA1.png"),
      storyA2: file("storyA2", "A/storyA2.png"),
    }),
    B: folder("B", "B", {
      storyB1: file("storyB1", "B/storyB1.png"),
      storyB2: file("storyB2", "B/storyB2.png"),
    }),
  });

describe("getVisualChildGroups", () => {
  it("sépare les fichiers des dossiers en conservant l’ordre relatif", () => {
    const { files, folders } = getVisualChildGroups(sampleTree().children!.A);

    expect(files.map(n => n.name)).toEqual(["storyA1", "storyA2"]);
    expect(folders.map(n => n.name)).toEqual(["SousA"]);
  });
});

describe("flattenTreeVisual", () => {
  it("liste les stories du dossier avant celles des sous-dossiers", () => {
    expect(flattenTreeVisual(sampleTree()).map(n => n.name)).toEqual([
      "storyA1",
      "storyA2",
      "storySousA1",
      "storySousA2",
      "storyB1",
      "storyB2",
    ]);
  });

  it("retourne [] pour null et le fichier lui-même pour un nœud fichier", () => {
    expect(flattenTreeVisual(null)).toEqual([]);
    expect(flattenTreeVisual(file("x", "x.png")).map(n => n.path)).toEqual(["x.png"]);
  });
});

describe("collectFolderPaths", () => {
  it("inclut le dossier courant et les descendants", () => {
    expect(collectFolderPaths(sampleTree())).toEqual(["", "A", "A/SousA", "B"]);
    expect(collectFolderPaths(sampleTree().children!.A)).toEqual(["A", "A/SousA"]);
  });

  it("retourne [] pour un fichier ou null", () => {
    expect(collectFolderPaths(null)).toEqual([]);
    expect(collectFolderPaths(file("x", "x.png"))).toEqual([]);
  });
});

describe("pathsInVisualRange", () => {
  const ordered = ["A/storyA1.png", "A/storyA2.png", "A/SousA/storySousA1.png", "B/storyB1.png"];

  it("sélectionne toutes les stories entre l’ancre et la cible", () => {
    expect(pathsInVisualRange(ordered, "A/storyA1.png", ["B/storyB1.png"])).toEqual(ordered);
  });

  it("fonctionne dans les deux sens", () => {
    expect(pathsInVisualRange(ordered, "B/storyB1.png", ["A/storyA2.png"])).toEqual([
      "A/storyA2.png",
      "A/SousA/storySousA1.png",
      "B/storyB1.png",
    ]);
  });

  it("étend jusqu’à toutes les cibles d’un groupe (devices d’une story)", () => {
    expect(pathsInVisualRange(ordered, "A/storyA1.png", ["A/storyA2.png", "A/SousA/storySousA1.png"])).toEqual([
      "A/storyA1.png",
      "A/storyA2.png",
      "A/SousA/storySousA1.png",
    ]);
  });

  it("retourne les cibles si l’ancre est absente", () => {
    expect(pathsInVisualRange(ordered, null, ["A/storyA2.png"])).toEqual(["A/storyA2.png"]);
    expect(pathsInVisualRange(ordered, "missing.png", ["A/storyA2.png"])).toEqual(["A/storyA2.png"]);
  });
});

describe("compareNodeTypeForDisplay", () => {
  it("place les fichiers avant les dossiers", () => {
    expect(compareNodeTypeForDisplay(file("a", "a"), folder("b", "b", {}))).toBe(-1);
    expect(compareNodeTypeForDisplay(folder("b", "b", {}), file("a", "a"))).toBe(1);
    expect(compareNodeTypeForDisplay(file("a", "a"), file("b", "b"))).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import type { Node } from "../types/types";

import {
  collectFilePaths,
  collectSelectableFilePaths,
  isSelectableTreeFile,
  selectionState,
  togglePaths,
} from "./tree-selection";

const file = (partial: Partial<Node> & Pick<Node, "name" | "path">): Node => ({
  type: "file",
  ...partial,
});

const folder = (name: string, path: string, children: Record<string, Node>): Node => ({
  type: "folder",
  name,
  path,
  children,
});

const sampleTree = (): Node =>
  folder("root", "", {
    Button: folder("Button", "Button", {
      "primary-desktop": file({
        name: "primary-desktop",
        path: "Button/primary-desktop.png",
      }),
      "primary-mobile": file({
        name: "primary-mobile",
        path: "Button/primary-mobile.png",
      }),
    }),
    Card: folder("Card", "Card", {
      "default-desktop": file({
        name: "default-desktop",
        path: "Card/default-desktop.png",
      }),
    }),
    Empty: folder("Empty", "Empty", {}),
  });

describe("collectFilePaths", () => {
  it("retourne le path d'un nœud fichier", () => {
    expect(collectFilePaths(file({ name: "a", path: "a.png" }))).toEqual(["a.png"]);
  });

  it("collecte tous les fichiers descendants d'un dossier", () => {
    expect(collectFilePaths(sampleTree())).toEqual([
      "Button/primary-desktop.png",
      "Button/primary-mobile.png",
      "Card/default-desktop.png",
    ]);
  });

  it("retourne [] pour un dossier vide", () => {
    expect(collectFilePaths(folder("Empty", "Empty", {}))).toEqual([]);
  });

  it("collecte sous un sous-arbre (story / dossier)", () => {
    const button = sampleTree().children!.Button;
    expect(collectFilePaths(button)).toEqual(["Button/primary-desktop.png", "Button/primary-mobile.png"]);
  });
});

describe("collectSelectableFilePaths", () => {
  it("exclut les fichiers ignore-vr", () => {
    const tree = folder("root", "", {
      Button: folder("Button", "Button", {
        ignored: file({
          name: "ignored-desktop",
          path: "Button/ignored-desktop.png",
          ignored: true,
        }),
        ok: file({
          name: "ok-desktop",
          path: "Button/ok-desktop.png",
        }),
      }),
    });

    expect(collectSelectableFilePaths(tree)).toEqual(["Button/ok-desktop.png"]);
  });
});

describe("isSelectableTreeFile", () => {
  it("retourne false pour ignored", () => {
    expect(isSelectableTreeFile(file({ name: "a", path: "a.png", ignored: true }))).toBe(false);
    expect(isSelectableTreeFile(file({ name: "a", path: "a.png" }))).toBe(true);
  });
});

describe("selectionState", () => {
  const paths = ["a.png", "b.png", "c.png"];

  it("retourne none si aucun path n'est sélectionné", () => {
    expect(selectionState(paths, new Set())).toBe("none");
    expect(selectionState(paths, new Set(["other.png"]))).toBe("none");
  });

  it("retourne all si tous les paths sont sélectionnés", () => {
    expect(selectionState(paths, new Set(paths))).toBe("all");
  });

  it("retourne partial si une partie seulement est sélectionnée", () => {
    expect(selectionState(paths, new Set(["a.png"]))).toBe("partial");
    expect(selectionState(paths, new Set(["a.png", "c.png"]))).toBe("partial");
  });

  it("retourne none pour une liste vide", () => {
    expect(selectionState([], new Set(["a.png"]))).toBe("none");
  });
});

describe("togglePaths", () => {
  it("ajoute les paths manquants (passage à all)", () => {
    expect(togglePaths(new Set(["a.png"]), ["a.png", "b.png"])).toEqual(new Set(["a.png", "b.png"]));
  });

  it("retire tous les paths si déjà tous sélectionnés", () => {
    expect(togglePaths(new Set(["a.png", "b.png", "c.png"]), ["a.png", "b.png"])).toEqual(new Set(["c.png"]));
  });

  it("n'altère pas l'ensemble d'origine", () => {
    const selected = new Set(["a.png"]);
    const next = togglePaths(selected, ["b.png"]);
    expect(selected).toEqual(new Set(["a.png"]));
    expect(next).toEqual(new Set(["a.png", "b.png"]));
  });

  it("ne change rien pour une liste vide", () => {
    expect(togglePaths(new Set(["a.png"]), [])).toEqual(new Set(["a.png"]));
  });
});

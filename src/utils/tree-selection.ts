import type { Node } from "../types/types";

export type SelectionState = "none" | "partial" | "all";

/** Fichier sélectionnable en multi-select (hors stories ignore-vr). */
export const isSelectableTreeFile = (node: Node): boolean => node.type === "file" && !node.ignored;

/** Collecte récursivement les paths des nœuds fichier sous `node` (fichier inclus). */
export const collectFilePaths = (node: Node): string[] => {
  if (node.type === "file") return [node.path];

  const paths: string[] = [];
  for (const child of Object.values(node.children ?? {})) {
    paths.push(...collectFilePaths(child));
  }
  return paths;
};

/** Comme collectFilePaths, sans les fichiers tagués ignore-vr (catalogue). */
export const collectSelectableFilePaths = (node: Node): string[] => {
  if (node.type === "file") return isSelectableTreeFile(node) ? [node.path] : [];

  const paths: string[] = [];
  for (const child of Object.values(node.children ?? {})) {
    paths.push(...collectSelectableFilePaths(child));
  }
  return paths;
};

/** État de sélection pour un groupe de paths fichier. */
export const selectionState = (paths: readonly string[], selected: ReadonlySet<string>): SelectionState => {
  if (paths.length === 0) return "none";

  let selectedCount = 0;
  for (const path of paths) {
    if (selected.has(path)) selectedCount += 1;
  }

  if (selectedCount === 0) return "none";
  if (selectedCount === paths.length) return "all";
  return "partial";
};

/**
 * Bascule un ensemble de paths dans la sélection :
 * si tous sont déjà sélectionnés → les retire ; sinon → les ajoute.
 */
export const togglePaths = (selected: ReadonlySet<string>, paths: readonly string[]): Set<string> => {
  const next = new Set(selected);
  if (paths.length === 0) return next;

  const allSelected = paths.every(path => next.has(path));
  if (allSelected) {
    for (const path of paths) next.delete(path);
  } else {
    for (const path of paths) next.add(path);
  }
  return next;
};

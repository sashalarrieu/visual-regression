import type { Node } from "../types/types";

import { flattenTreeVisual } from "./tree-order";

export type SelectionState = "none" | "partial" | "all";

/** Fichier sélectionnable en multi-select (hors stories ignore-vr). */
export const isSelectableTreeFile = (node: Node): boolean => node.type === "file" && !node.ignored;

/** Collecte récursivement les paths des nœuds fichier sous `node` (fichier inclus), ordre visuel. */
export const collectFilePaths = (node: Node): string[] => flattenTreeVisual(node).map(file => file.path);

/** Comme collectFilePaths, sans les fichiers tagués ignore-vr (catalogue). */
export const collectSelectableFilePaths = (node: Node): string[] =>
  flattenTreeVisual(node)
    .filter(isSelectableTreeFile)
    .map(file => file.path);

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

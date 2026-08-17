import type { Node } from "../types/types";

/** Enfants d’un dossier, dans l’ordre d’affichage : stories (fichiers) puis sous-dossiers. */
export const getVisualChildGroups = (node: Node): { files: Node[]; folders: Node[] } => {
  const files: Node[] = [];
  const folders: Node[] = [];
  for (const child of Object.values(node.children ?? {})) {
    if (child.type === "file") files.push(child);
    else folders.push(child);
  }
  return { files, folders };
};

/**
 * Fichiers dans l’ordre visuel de l’arbre :
 * à chaque niveau, les stories du dossier courant, puis le contenu des sous-dossiers.
 */
export const flattenTreeVisual = (node: Node | null): Node[] => {
  if (!node) return [];
  if (node.type === "file") return [node];

  const { files, folders } = getVisualChildGroups(node);
  const out: Node[] = [...files];
  for (const folder of folders) out.push(...flattenTreeVisual(folder));
  return out;
};

/** Paths de `node` (s’il est un dossier) et de tous les sous-dossiers, ordre visuel. */
export const collectFolderPaths = (node: Node | null): string[] => {
  if (!node || node.type === "file") return [];

  const paths = [node.path];
  const { folders } = getVisualChildGroups(node);
  for (const folder of folders) paths.push(...collectFolderPaths(folder));
  return paths;
};

/**
 * Paths fichier entre l’ancre et les cibles, inclus, selon `orderedPaths` (ordre visuel).
 * Si l’ancre ou les cibles sont introuvables, retourne les cibles.
 */
export const pathsInVisualRange = (
  orderedPaths: readonly string[],
  anchorPath: string | null | undefined,
  targetPaths: readonly string[],
): string[] => {
  if (targetPaths.length === 0) return [];
  if (orderedPaths.length === 0) return [...targetPaths];

  const indexByPath = new Map(orderedPaths.map((path, index) => [path, index]));
  const targetIndices = targetPaths
    .map(path => indexByPath.get(path))
    .filter((index): index is number => index !== undefined);

  if (targetIndices.length === 0) return [...targetPaths];

  const anchorIndex = anchorPath ? indexByPath.get(anchorPath) : undefined;
  const start = anchorIndex === undefined ? Math.min(...targetIndices) : Math.min(anchorIndex, ...targetIndices);
  const end = anchorIndex === undefined ? Math.max(...targetIndices) : Math.max(anchorIndex, ...targetIndices);
  return orderedPaths.slice(start, end + 1);
};

/** Fichiers avant dossiers, pour le tri serveur aligné sur l’UI. */
export const compareNodeTypeForDisplay = (a: Node, b: Node): number => {
  if (a.type === b.type) return 0;
  return a.type === "file" ? -1 : 1;
};

import type { Node } from "../types/types";

/** Mode d’arbre VR (onglet actif). */
export type TreePanelMode = "regressions" | "all-stories" | "orphans";

/** Valeurs des chips de filtre de statut (selon le mode). */
export type StatusFilterValue = "new" | "diff" | "baseline" | "missing" | "block";

export type FilterTreeOptions = {
  /** Recherche case-insensitive (sous-chaîne ou flou sous-séquence) sur path / storyId / displayName / name. */
  query?: string;
  /**
   * Chips multi-sélection. Ensemble vide / absent = tout afficher.
   * Combiné en AND avec `query` ; entre chips = OR.
   * Ignoré en mode `orphans`.
   */
  statuses?: ReadonlySet<StatusFilterValue> | Iterable<StatusFilterValue>;
  mode?: TreePanelMode;
};

const normalizeQuery = (query: string | undefined): string => (query ?? "").trim().toLowerCase();

const toStatusSet = (statuses: FilterTreeOptions["statuses"]): ReadonlySet<StatusFilterValue> => {
  if (!statuses) return new Set();
  if (statuses instanceof Set) return statuses;
  return new Set(statuses);
};

/** Match flou type fzf : tous les caractères de `query` apparaissent dans l’ordre dans `haystack`. */
export const isSubsequenceMatch = (query: string, haystack: string): boolean => {
  if (!query) return true;
  if (!haystack) return false;
  let qi = 0;
  for (let hi = 0; hi < haystack.length && qi < query.length; hi++) {
    if (haystack[hi] === query[qi]) qi++;
  }
  return qi === query.length;
};

const buildSearchHaystack = (node: Node): string =>
  [node.path, node.storyId, node.displayName, node.name]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

/**
 * Recherche case-insensitive :
 * - tokens séparés par des espaces (AND) ;
 * - chaque token matche en sous-chaîne OU en sous-séquence (typos / abréviations type `demo/compoxdc`).
 */
const fileMatchesQuery = (node: Node, query: string): boolean => {
  if (!query) return true;
  const haystack = buildSearchHaystack(node);
  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every(token => haystack.includes(token) || isSubsequenceMatch(token, haystack));
};

/**
 * Un fichier matche le filtre de statut s’il satisfait au moins une chip.
 * - regressions : `new` | `diff` via `storyType`
 * - all-stories : `baseline` | `missing` via `storyType`, `block` via `ignored === true`
 */
const fileMatchesStatuses = (node: Node, statuses: ReadonlySet<StatusFilterValue>, mode: TreePanelMode): boolean => {
  if (mode === "orphans" || statuses.size === 0) return true;

  for (const status of statuses) {
    if (status === "block") {
      if (node.ignored === true) return true;
      continue;
    }
    if (node.storyType === status) return true;
  }
  return false;
};

const recalculateFolderCounts = (node: Node, mode: TreePanelMode): void => {
  if (node.type === "file") return;

  let countDiff = 0;
  let countNew = 0;
  let countBaseline = 0;
  let countMissing = 0;
  let countIgnored = 0;
  let countTotal = 0;

  for (const child of Object.values(node.children ?? {})) {
    if (child.type === "file") {
      countTotal++;
      if (child.storyType === "diff") countDiff++;
      else if (child.storyType === "new") countNew++;
      else if (child.storyType === "baseline") countBaseline++;
      else if (child.storyType === "missing") countMissing++;
      if (child.ignored) countIgnored++;
    } else {
      recalculateFolderCounts(child, mode);
      countDiff += child.countDiff || 0;
      countNew += child.countNew || 0;
      countBaseline += child.countBaseline || 0;
      countMissing += child.countMissing || 0;
      countIgnored += child.countIgnored || 0;
      countTotal += child.countTotal || 0;
    }
  }

  node.countTotal = countTotal;
  if (mode === "all-stories") {
    node.countBaseline = countBaseline;
    node.countMissing = countMissing;
    node.countIgnored = countIgnored;
  } else {
    node.countDiff = countDiff;
    node.countNew = countNew;
  }
};

/**
 * Filtre un arbre VR par recherche texte et/ou chips de statut.
 * Les dossiers sans fichier restant sont masqués. Retourne `null` si rien ne match.
 */
export const filterTree = (node: Node | null, options: FilterTreeOptions = {}): Node | null => {
  if (!node) return null;

  const query = normalizeQuery(options.query);
  const statuses = toStatusSet(options.statuses);
  const mode: TreePanelMode = options.mode ?? "regressions";

  if (!query && (mode === "orphans" || statuses.size === 0)) {
    return node;
  }

  const filterNode = (current: Node): Node | null => {
    if (current.type === "file") {
      if (!fileMatchesQuery(current, query)) return null;
      if (!fileMatchesStatuses(current, statuses, mode)) return null;
      return current;
    }

    const filteredChildren: Record<string, Node> = {};
    for (const [key, child] of Object.entries(current.children ?? {})) {
      const filtered = filterNode(child);
      if (filtered) filteredChildren[key] = filtered;
    }

    if (Object.keys(filteredChildren).length === 0) return null;

    const next: Node = {
      ...current,
      children: filteredChildren,
    };
    recalculateFolderCounts(next, mode);
    return next;
  };

  return filterNode(node);
};

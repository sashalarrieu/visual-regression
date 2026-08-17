/** Largeur initiale du panneau gauche (arbre) — identique à l’ancien layout fixe. */
export const DEFAULT_SPLIT_LEFT_WIDTH = 300;
export const DEFAULT_SPLIT_MIN_LEFT_WIDTH = 200;
export const DEFAULT_SPLIT_MIN_RIGHT_WIDTH = 320;

/**
 * Borne la largeur du panneau gauche dans l’espace disponible.
 * Si le conteneur est trop étroit pour honorer les deux minimums, on se contente de [0, containerWidth].
 */
export const clampSplitPaneWidth = (
  width: number,
  containerWidth: number,
  minLeftWidth: number,
  minRightWidth: number,
): number => {
  if (containerWidth <= 0) return width;
  const maxLeft = containerWidth - minRightWidth;
  if (maxLeft < minLeftWidth) {
    return Math.min(Math.max(0, width), containerWidth);
  }
  return Math.min(Math.max(width, minLeftWidth), maxLeft);
};

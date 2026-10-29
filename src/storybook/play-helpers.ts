import { VR_CAPTURE_CLASSIC_SCROLLBAR_CSS } from "../constants/constants";

/** Helpers play() sans @storybook/test — clics et assertions DOM (RN Web). */

export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const normalizeLabel = (value: string): string => value.trim().toLowerCase();

const elementMatchesLabel = (el: HTMLElement, label: string): boolean => {
  const normLabel = normalizeLabel(label);
  const aria = el.getAttribute("aria-label");
  if (aria && normalizeLabel(aria).includes(normLabel)) return true;
  const text = el.textContent?.trim() ?? "";
  if (!text) return false;
  return text === label || normalizeLabel(text).includes(normLabel) || text.includes(label);
};

const findClickableByLabel = (root: HTMLElement, label: string): HTMLElement | null => {
  const byAria = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (byAria) return byAria;

  const candidates = [
    ...Array.from(root.querySelectorAll<HTMLElement>('[role="button"]')),
    ...Array.from(root.querySelectorAll<HTMLElement>("button")),
    ...Array.from(root.querySelectorAll<HTMLElement>('[tabindex="0"]')),
  ];
  return candidates.find(el => elementMatchesLabel(el, label)) ?? null;
};

/**
 * Attend qu'un bouton cliquable existe avant de le renvoyer.
 * Indispensable car `play()` (useLayoutEffect) démarre parfois avant que le
 * contenu de la story soit rendu (providers client / layout asynchrones) → sans
 * cette attente, les premiers clics sont perdus et le résultat devient aléatoire.
 */
export const waitForClickable = async (root: HTMLElement, label: string, timeout = 2000): Promise<HTMLElement> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const el = findClickableByLabel(root, label);
    if (el) return el;
    if (Date.now() >= deadline) throw new Error(`Bouton introuvable : "${label}"`);
    await delay(30);
  }
};

export const clickByLabel = async (root: HTMLElement, label: string): Promise<void> => {
  // RN Web (Pressable) ne réagit de façon fiable qu'au `.click()` natif ; les
  // événements pointer/souris synthétiques n'activent pas `onPress`. `.click()`
  // déclenche `onPress` exactement une fois → pas de risque de double-incrément.
  (await waitForClickable(root, label)).click();
  await delay(0);
};

/** Attend qu'un prédicat soit vrai (poll), sinon échoue après `timeout` ms. */
export const waitFor = async (
  predicate: () => boolean,
  {
    timeout = 2000,
    interval = 30,
    message = "Condition non remplie dans le délai imparti",
  }: { timeout?: number; interval?: number; message?: string } = {},
): Promise<void> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await delay(interval);
  }
};

const SCROLL_OVERFLOW_THRESHOLD = 2;

export const overflowDelta = (
  el: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight">,
  axis: "x" | "y",
): number => (axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight);

export const elementOverflows = (
  el: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight">,
  axis: "x" | "y",
): boolean => overflowDelta(el, axis) > SCROLL_OVERFLOW_THRESHOLD;

export const isScrolledToEnd = (
  el: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight" | "scrollLeft" | "scrollTop">,
  axis: "x" | "y",
): boolean =>
  axis === "x"
    ? el.scrollLeft + el.clientWidth >= el.scrollWidth - SCROLL_OVERFLOW_THRESHOLD
    : el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_OVERFLOW_THRESHOLD;

/**
 * RN Web : le nœud overflow est souvent un descendant du `testID`.
 * Préfère overflow auto/scroll, puis le plus grand delta (évite un nœud à 3px).
 */
export const findOverflowScroller = (root: HTMLElement, axis: "x" | "y"): HTMLElement => {
  const overflowProp = axis === "x" ? "overflowX" : "overflowY";
  const ranked: { el: HTMLElement; delta: number; preferred: boolean }[] = [];
  const visit = (el: HTMLElement) => {
    const delta = overflowDelta(el, axis);
    if (delta <= SCROLL_OVERFLOW_THRESHOLD) return;
    const overflow = typeof getComputedStyle === "function" ? getComputedStyle(el)[overflowProp] : "";
    const preferred = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    ranked.push({ el, delta, preferred });
  };
  visit(root);
  for (const node of Array.from(root.querySelectorAll("*"))) {
    if (node instanceof HTMLElement) visit(node);
  }
  if (ranked.length === 0) return root;
  const preferred = ranked.filter(item => item.preferred);
  const pool = preferred.length > 0 ? preferred : ranked;
  return pool.reduce((best, item) => (item.delta > best.delta ? item : best)).el;
};

const scrollScrollerToEnd = (scroller: HTMLElement, axis: "x" | "y"): void => {
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({
      left: axis === "x" ? scroller.scrollWidth : scroller.scrollLeft,
      top: axis === "y" ? scroller.scrollHeight : scroller.scrollTop,
      behavior: "instant",
    });
  } else if (axis === "x") {
    scroller.scrollLeft = scroller.scrollWidth;
  } else {
    scroller.scrollTop = scroller.scrollHeight;
  }
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
};

/** Pose le scroll en fin sans attendre (RN Web : `scrollTop` parfois no-op, à coupler à `scrollToEnd`). */
export const jumpToScrollEnd = (root: HTMLElement, axis: "x" | "y"): HTMLElement => {
  const scroller = findOverflowScroller(root, axis);
  scrollScrollerToEnd(scroller, axis);
  return scroller;
};

/** Scroll jusqu'à la fin une fois la taille de contenu stable (VirtualizedList). */
export const scrollElementToEnd = async (root: HTMLElement, axis: "x" | "y"): Promise<HTMLElement> => {
  let scroller = root;
  let lastSize = -1;
  let atEndHits = 0;
  await waitFor(
    () => {
      scroller = findOverflowScroller(root, axis);
      const size = axis === "x" ? scroller.scrollWidth : scroller.scrollHeight;
      if (axis === "x" && scroller.clientWidth <= 0) return false;
      if (axis === "y" && scroller.clientHeight <= 0) return false;
      if (!elementOverflows(scroller, axis)) return false;
      scrollScrollerToEnd(scroller, axis);
      const atEnd = isScrolledToEnd(scroller, axis);
      if (atEnd && size === lastSize) {
        atEndHits += 1;
        return atEndHits >= 2;
      }
      lastSize = size;
      atEndHits = 0;
      return false;
    },
    { timeout: 4000, message: `Liste non scrollée jusqu'à la fin (${axis})` },
  );
  return scroller;
};

const CLASSIC_SCROLLBAR_STYLE_ID = "vr-classic-scrollbars";

/** Overlay Chromium → barres classiques. No-op hors navigateur. */
export const applyClassicScrollbarsInPage = (): void => {
  if (typeof document === "undefined") return;

  if (!document.getElementById(CLASSIC_SCROLLBAR_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = CLASSIC_SCROLLBAR_STYLE_ID;
    style.textContent = VR_CAPTURE_CLASSIC_SCROLLBAR_CSS;
    document.head.appendChild(style);
  }

  const threshold = 2;
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!(el instanceof HTMLElement)) continue;
    const computed = window.getComputedStyle(el);
    const overflowY = computed.overflowY;
    const overflowX = computed.overflowX;
    const canY = overflowY === "auto" || overflowY === "overlay" || overflowY === "scroll" || overflowY === "hidden";
    const canX = overflowX === "auto" || overflowX === "overlay" || overflowX === "scroll" || overflowX === "hidden";
    if (canY && el.scrollHeight > el.clientHeight + threshold) {
      el.style.setProperty("overflow-y", "scroll", "important");
    }
    if (canX && el.scrollWidth > el.clientWidth + threshold) {
      el.style.setProperty("overflow-x", "scroll", "important");
    }
  }
};

/** Attend qu'un élément avec l'aria-label donné soit présent. */
export const waitForAriaLabel = (root: HTMLElement, label: string, timeout = 2000): Promise<void> =>
  waitFor(() => Boolean(root.querySelector(`[aria-label="${label}"]`)), { timeout });

/**
 * Clique une fois sur `label` puis attend l'état `expectedAriaLabel` (vérification
 * de l'incrément). Pas de retry : le clic `.click()` est fiable et déclenche
 * `onPress` exactement une fois — un retry provoquerait un double-incrément sur
 * une action non idempotente (compteur). Échoue si l'état attendu n'est pas atteint.
 */
export const clickByLabelExpect = async (
  root: HTMLElement,
  label: string,
  expectedAriaLabel: string,
  timeout = 2000,
): Promise<void> => {
  await clickByLabel(root, label);
  await waitForAriaLabel(root, expectedAriaLabel, timeout);
};

export const expectText = (root: HTMLElement, text: string): void => {
  if (!root.textContent?.includes(text)) {
    throw new Error(`Texte attendu introuvable : "${text}"`);
  }
};

export const expectAriaLabel = (root: HTMLElement, label: string): void => {
  if (!root.querySelector(`[aria-label="${label}"]`)) {
    throw new Error(`aria-label attendu introuvable : "${label}"`);
  }
};

export const expectNoAriaLabel = (root: HTMLElement, label: string): void => {
  if (root.querySelector(`[aria-label="${label}"]`)) {
    throw new Error(`aria-label inattendu présent : "${label}"`);
  }
};

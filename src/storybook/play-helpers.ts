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
 * contenu de la story soit rendu (SafeAreaProvider/GestureHandler rendent leurs
 * enfants après une passe de layout) → sans cette attente, les premiers clics
 * sont perdus et le résultat devient aléatoire.
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
  { timeout = 2000, interval = 30 }: { timeout?: number; interval?: number } = {},
): Promise<void> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) throw new Error("Condition non remplie dans le délai imparti");
    await delay(interval);
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

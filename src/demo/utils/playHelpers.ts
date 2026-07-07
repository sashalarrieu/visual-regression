/** Helpers play() sans @storybook/test — clics et assertions DOM (RN Web). */

export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const findClickableByLabel = (root: HTMLElement, label: string): HTMLElement => {
  const candidates = [
    ...Array.from(root.querySelectorAll<HTMLElement>('[role="button"]')),
    ...Array.from(root.querySelectorAll<HTMLElement>("button")),
  ];
  const match = candidates.find(el => el.textContent?.trim() === label);
  if (!match) {
    throw new Error(`Bouton introuvable : "${label}"`);
  }
  return match;
};

export const clickByLabel = async (root: HTMLElement, label: string): Promise<void> => {
  findClickableByLabel(root, label).click();
  await delay(0);
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

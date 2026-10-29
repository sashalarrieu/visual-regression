/**
 * Exécution de `play()` Storybook en mode capture VR (preview decorator).
 * Compatible navigateur — pas d'imports Node.
 */

export type VrStoryPlayStep = (label: string, play: () => Promise<void> | void) => Promise<void>;

export type VrStoryPlayContext = {
  canvasElement: HTMLElement;
  step: VrStoryPlayStep;
};

export type VrStoryPlayFunction = (context: VrStoryPlayContext) => Promise<void> | void;

type StoryContextLike = Record<string, unknown> & {
  canvasElement?: HTMLElement;
  step?: VrStoryPlayStep;
  runStep?: VrStoryPlayStep;
  playFunction?: VrStoryPlayFunction;
};

const defaultStep: VrStoryPlayStep = async (_label, play) => {
  await play();
};

/** Contexte minimal passé à `play()` — aligné sur les helpers demo (`canvasElement`, `step`). */
export const buildPlayContext = (context: StoryContextLike): VrStoryPlayContext => {
  const canvasElement =
    context.canvasElement ?? (document.getElementById("storybook-root") as HTMLElement | null) ?? document.body;

  const step = context.step ?? context.runStep ?? defaultStep;

  return { canvasElement, step };
};

export const resolveStoryPlayFunction = (context: StoryContextLike): VrStoryPlayFunction | undefined => {
  const playFn = context.playFunction;
  return typeof playFn === "function" ? playFn : undefined;
};

export type VrStoryPlayRunnerStatus = "pending" | "success" | "error";

/**
 * Rejouer `play()` uniquement si Storybook ne l'a pas réellement exécuté
 * (static no-op historique). Un second play sur un état déjà muté fait échouer
 * les assertions (spies, findBy* d'éléments disparus).
 */
export const shouldReplayVrStoryPlay = ({
  hasPortal,
  playStarted,
}: {
  hasPortal: boolean;
  playStarted: boolean;
}): boolean => {
  if (hasPortal) return false;
  if (playStarted) return false;
  return true;
};

type PortalDocument = {
  getElementById: (id: string) => { contains: (el: Element) => boolean } | null;
  querySelectorAll: (selector: string) => ArrayLike<Element>;
  defaultView?: {
    innerWidth?: number;
    innerHeight?: number;
    getComputedStyle: (el: Element) => {
      display: string;
      visibility: string;
      opacity?: string;
      pointerEvents?: string;
    };
  } | null;
};

/**
 * Dialog / aria-modal **hors** `#storybook-root`, réellement ouvert.
 * Un nœud `[role=dialog]` à 0×0, opacity 0, aria-hidden, ou coquille full-viewport
 * vide (Modal RNW fermée) ne compte pas — sinon on saute `play()` / on capture
 * une page blanche classée en fail visuel.
 */
export const hasVisiblePortalDialogOutsideRoot = (doc?: PortalDocument): boolean => {
  const resolved = doc ?? (typeof document === "undefined" ? undefined : document);
  if (!resolved) return false;
  const root = resolved.getElementById("storybook-root");
  const view = resolved.defaultView;
  const viewportW = view?.innerWidth ?? 0;
  const viewportH = view?.innerHeight ?? 0;
  return Array.from(resolved.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(el => {
    if (root?.contains(el)) return false;
    if (typeof el.getAttribute === "function" && el.getAttribute("aria-hidden") === "true") return false;
    const box =
      typeof (el as HTMLElement).getBoundingClientRect === "function"
        ? (el as HTMLElement).getBoundingClientRect()
        : { width: 0, height: 0 };
    if (box.width < 1 || box.height < 1) return false;
    const style = view?.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    if (style && Number(style.opacity) === 0) return false;
    const innerText = typeof (el as HTMLElement).innerText === "string" ? (el as HTMLElement).innerText.trim() : "";
    const coversViewport = viewportW > 0 && viewportH > 0 && box.width >= viewportW - 2 && box.height >= viewportH - 2;
    if (coversViewport && innerText.length === 0) return false;
    return true;
  });
};

export const formatVrPlayError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error == null) return "";
  try {
    return String(error);
  } catch {
    return "";
  }
};

/** Exécute `play()` avec le contexte Storybook complet (playFunction attend le contexte entier). */
export const runVrStoryPlay = async (context: StoryContextLike): Promise<void> => {
  const playFn = resolveStoryPlayFunction(context);
  if (!playFn) return;

  const root = document.getElementById("storybook-root");
  const playContext: StoryContextLike = {
    ...context,
    canvasElement: context.canvasElement ?? root ?? document.body,
  };

  await (playFn as (ctx: StoryContextLike) => Promise<void> | void)(playContext);
};

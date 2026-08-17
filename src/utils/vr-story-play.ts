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

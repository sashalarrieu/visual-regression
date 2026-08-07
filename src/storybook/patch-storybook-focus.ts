/**
 * Storybook 10.5+ instrumente HTMLElement.prototype.focus avec un getter qui lit
 * `this.ownerDocument`. react-aria (addon-docs) fait :
 *   const focus = HTMLElement.prototype.focus
 * → getter appelé avec `this === HTMLElement.prototype` → TypeError: Illegal invocation
 * → Docs ne se rendent jamais.
 *
 * Voir https://github.com/storybookjs/storybook/issues/35503 (fix PR #35528 encore ouvert).
 *
 * On enveloppe Object.defineProperties pour sécuriser l’install Storybook, et on
 * re-patche si le getter cassé est déjà en place.
 */

const isIllegalInvocation = (err: unknown): boolean =>
  err instanceof TypeError && /Illegal invocation/i.test(String(err.message));

const wrapFocusDescriptor = (focusDesc: PropertyDescriptor): PropertyDescriptor => {
  const brokenGet = focusDesc.get;
  if (!brokenGet) return focusDesc;

  return {
    ...focusDesc,
    get(this: HTMLElement) {
      try {
        return brokenGet.call(this);
      } catch (err) {
        if (!isIllegalInvocation(err)) throw err;
        // Lecture sur le prototype (ou realm invalide) — renvoyer la méthode
        // qu'une instance réelle obtiendrait, pour le pattern capture-and-wrap.
        if (typeof document !== "undefined" && document.documentElement) {
          return brokenGet.call(document.documentElement);
        }
        throw err;
      }
    },
  };
};

const patchInstalledFocusGetter = (): boolean => {
  if (typeof HTMLElement === "undefined") return false;
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "focus");
  if (!desc?.get || !desc.configurable) return false;

  // Déjà safe ?
  try {
    desc.get.call(HTMLElement.prototype);
    return false;
  } catch (err) {
    if (!isIllegalInvocation(err)) return false;
  }

  Object.defineProperty(HTMLElement.prototype, "focus", wrapFocusDescriptor(desc));
  return true;
};

let definePropertiesWrapped = false;

const wrapDefineProperties = (): void => {
  if (definePropertiesWrapped || typeof Object.defineProperties !== "function") return;
  definePropertiesWrapped = true;

  const original = Object.defineProperties.bind(Object) as typeof Object.defineProperties;
  Object.defineProperties = ((target: object, props: PropertyDescriptorMap & ThisType<unknown>) => {
    if (
      typeof HTMLElement !== "undefined" &&
      target === HTMLElement.prototype &&
      props &&
      typeof (props as { focus?: PropertyDescriptor }).focus?.get === "function"
    ) {
      const next = { ...props } as PropertyDescriptorMap & ThisType<unknown>;
      next.focus = wrapFocusDescriptor((props as { focus: PropertyDescriptor }).focus);
      return original(target, next);
    }
    return original(target, props);
  }) as typeof Object.defineProperties;
};

/** À appeler dès l'entrée preview (side-effect safe, idempotent). */
export const patchStorybookFocusForDocs = (): void => {
  if (typeof window === "undefined") return;
  wrapDefineProperties();
  patchInstalledFocusGetter();
};

// Side-effect à l'import — avant navigation Docs.
patchStorybookFocusForDocs();

/**
 * Addons Storybook incompatibles avec le sidecar de capture (pas de runner Vitest).
 * Sans ça, `@storybook/addon-vitest` attend un leader UniversalStore `storybook/test`
 * et log `SB_MANAGER_UNIVERSAL-STORE_0001` dans la console du manager.
 */
export const VR_CAPTURE_INCOMPATIBLE_ADDONS = ["@storybook/addon-vitest"] as const;

export const isVrCaptureStorybook = (): boolean => process.env.VR_DOCKER === "1" || process.env.VR_CAPTURE === "1";

const addonName = (addon: unknown): string | undefined => {
  if (typeof addon === "string") return addon;
  if (addon && typeof addon === "object" && "name" in addon) {
    const name = (addon as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

/** Filtre les addons qui cassent le Storybook du sidecar (`yarn vr`). */
export function vrStorybookAddons(addons: unknown[]): unknown[] {
  if (!isVrCaptureStorybook()) return addons;
  return addons.filter(addon => {
    const name = addonName(addon);
    return !name || !(VR_CAPTURE_INCOMPATIBLE_ADDONS as readonly string[]).includes(name);
  });
}

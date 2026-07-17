import path from "path";

import { describe, expect, it } from "vitest";

import { toDockerProjectPath } from "./vr-docker";

describe("toDockerProjectPath", () => {
  const root = "/Users/me/Documents/dev/MyApp";

  it("mappe un chemin absolu sous le projet vers /work/...", () => {
    expect(toDockerProjectPath(root, path.join(root, "apps/storybook/.storybook"))).toBe(
      "/work/apps/storybook/.storybook",
    );
  });

  it("mappe un chemin relatif vers /work/...", () => {
    expect(toDockerProjectPath(root, "apps/storybook/.storybook")).toBe("/work/apps/storybook/.storybook");
  });

  it("conserve un chemin déjà sous /work", () => {
    expect(toDockerProjectPath(root, "/work/apps/storybook/.storybook")).toBe("/work/apps/storybook/.storybook");
  });

  it("retourne vide pour une chaîne vide", () => {
    expect(toDockerProjectPath(root, "")).toBe("");
  });
});

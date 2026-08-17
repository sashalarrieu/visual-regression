import path from "path";

import { describe, expect, it } from "vitest";

import { findYarnLockSpecifierMismatch, resolveYarnLockPlaywrightVersion, toDockerProjectPath } from "./vr-docker";

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

describe("findYarnLockSpecifierMismatch", () => {
  const lock = `"@setshao/visual-regression@file:../visual-regression":
  version "1.2.0"
`;

  it("détecte file: vs version npm", () => {
    const msg = findYarnLockSpecifierMismatch({ devDependencies: { "@setshao/visual-regression": "1.2.0" } }, lock);
    expect(msg).toContain("1.2.0");
    expect(msg).toContain("yarn.lock");
  });

  it("est silencieux quand le specifier matche", () => {
    expect(
      findYarnLockSpecifierMismatch(
        { devDependencies: { "@setshao/visual-regression": "file:../visual-regression" } },
        lock,
      ),
    ).toBeNull();
  });

  it("ignore l'absence de la dépendance", () => {
    expect(findYarnLockSpecifierMismatch({ dependencies: { react: "19.0.0" } }, lock)).toBeNull();
  });
});

describe("resolveYarnLockPlaywrightVersion", () => {
  const lock = `playwright@^1.54.2:
  version "1.60.0"

playwright@^1.61.1:
  version "1.62.1"
`;

  it("résout le specifier de capture, pas le Playwright Vitest hôte", () => {
    expect(resolveYarnLockPlaywrightVersion(lock, "^1.61.1")).toBe("1.62.1");
    expect(resolveYarnLockPlaywrightVersion(lock, "^1.54.2")).toBe("1.60.0");
  });

  it("résout un pin exact", () => {
    const exact = `playwright@1.61.1:
  version "1.61.1"
`;
    expect(resolveYarnLockPlaywrightVersion(exact, "1.61.1")).toBe("1.61.1");
  });
});

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

describe("findYarnLockSpecifierMismatch", () => {
  const lock = `"@setshao/visual-regression@file:../visual-regression":
  version "1.2.0"
`;

  it("détecte file: vs version npm", () => {
    const msg = findYarnLockSpecifierMismatch({ devDependencies: { "@setshao/visual-regression": "1.2.0" } }, lock);
    expect(msg).toContain("1.2.0");
    expect(msg).toContain("yarn.lock");
  });

  it("est silencieux quand le specifier matche", () => {
    expect(
      findYarnLockSpecifierMismatch(
        { devDependencies: { "@setshao/visual-regression": "file:../visual-regression" } },
        lock,
      ),
    ).toBeNull();
  });

  it("ignore l'absence de la dépendance", () => {
    expect(findYarnLockSpecifierMismatch({ dependencies: { react: "19.0.0" } }, lock)).toBeNull();
  });
});

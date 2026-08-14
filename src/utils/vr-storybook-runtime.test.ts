import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeStorybookInputFingerprint,
  needsStaticStorybookBuild,
  resolveStorybookModeForCapture,
  writeStoredStorybookInputFingerprint,
} from "./vr-storybook-runtime";

const libRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("resolveStorybookModeForCapture", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VR_STORYBOOK_MODE;
    delete process.env.VR_STORYBOOK_STATIC;
  });

  it("honors VR_STORYBOOK_MODE", () => {
    process.env.VR_STORYBOOK_MODE = "static";
    expect(resolveStorybookModeForCapture(libRoot)).toBe("static");
    process.env.VR_STORYBOOK_MODE = "dev";
    expect(resolveStorybookModeForCapture(libRoot)).toBe("dev");
  });

  it("honors launcher.storybookMode in vr.config.cjs (env still wins)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vr-sb-mode-"));
    writeFileSync(
      path.join(root, "vr.config.cjs"),
      `module.exports = {
  devices: [{ name: "d", viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false }],
  launcher: { storybookMode: "static" },
};
`,
    );
    delete process.env.VR_STORYBOOK_MODE;
    delete process.env.VR_STORYBOOK_STATIC;
    expect(resolveStorybookModeForCapture(root)).toBe("static");

    process.env.VR_STORYBOOK_MODE = "dev";
    expect(resolveStorybookModeForCapture(root)).toBe("dev");
  });

  it("defaults to live HMR even inside Docker", () => {
    delete process.env.VR_STORYBOOK_MODE;
    delete process.env.VR_STORYBOOK_STATIC;
    process.env.VR_DOCKER = "1";
    expect(resolveStorybookModeForCapture(libRoot)).toBe("dev");
  });
});

describe("storybook input fingerprint", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VR_STORYBOOK_STATIC_REBUILD;
  });

  const tmpProject = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), "vr-sb-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "storybook-static"), { recursive: true });
    writeFileSync(path.join(root, "storybook-static", "index.html"), "<html></html>");
    writeFileSync(path.join(root, "storybook-static", "preview-stats.json"), "{}");
    writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const A = {};\n");
    return root;
  };

  it("changes when a story file changes", () => {
    const root = tmpProject();
    const before = computeStorybookInputFingerprint(root);
    writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const B = {};\n");
    expect(computeStorybookInputFingerprint(root)).not.toBe(before);
  });

  it("needs a rebuild when the stored fingerprint is missing or stale", () => {
    const root = tmpProject();
    expect(needsStaticStorybookBuild(root, "storybook-static/preview-stats.json")).toBe(true);

    writeStoredStorybookInputFingerprint(root);
    expect(needsStaticStorybookBuild(root, "storybook-static/preview-stats.json")).toBe(false);

    writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const Changed = {};\n");
    expect(needsStaticStorybookBuild(root, "storybook-static/preview-stats.json")).toBe(true);
  });
});

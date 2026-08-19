import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectStorybookInputFiles,
  computeStorybookInputFingerprint,
  needsStaticStorybookBuild,
  resolveStorybookModeForCapture,
  STORYBOOK_INPUT_FINGERPRINT_VERSION,
  writeStoredStorybookInputFingerprint,
} from "./vr-storybook-runtime";

const libRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("resolveStorybookModeForCapture", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VR_STORYBOOK_MODE;
    delete process.env.VR_STORYBOOK_STATIC;
    delete process.env.CI;
    delete process.env.VR_ENTRYPOINT_CMD;
  });

  it("honors VR_STORYBOOK_MODE", () => {
    process.env.VR_STORYBOOK_MODE = "static";
    expect(resolveStorybookModeForCapture(libRoot)).toBe("static");
    process.env.VR_STORYBOOK_MODE = "dev";
    expect(resolveStorybookModeForCapture(libRoot)).toBe("dev");
  });

  it("honors launcher.storybookMode from vr.config locally", () => {
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
    delete process.env.CI;
    delete process.env.VR_ENTRYPOINT_CMD;
    expect(resolveStorybookModeForCapture(root)).toBe("static");

    process.env.VR_STORYBOOK_MODE = "dev";
    expect(resolveStorybookModeForCapture(root)).toBe("dev");
  });

  it("defaults to live HMR when vr.config omits storybookMode", () => {
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

  it("needs a rebuild when the stored fingerprint has no version prefix (v1)", () => {
    const root = tmpProject();
    writeStoredStorybookInputFingerprint(root);
    const fingerprintPath = path.join(root, ".vr-cache", "storybook-input.fingerprint");
    const current = readFileSync(fingerprintPath, "utf8");
    expect(current.startsWith(`${STORYBOOK_INPUT_FINGERPRINT_VERSION}:`)).toBe(true);
    writeFileSync(fingerprintPath, `${computeStorybookInputFingerprint(root)}\n`);
    expect(needsStaticStorybookBuild(root, "storybook-static/preview-stats.json")).toBe(true);
  });

  it("includes monorepo packages and svg/json next to src/", () => {
    const root = tmpProject();
    mkdirSync(path.join(root, "packages", "ui", "src"), { recursive: true });
    writeFileSync(path.join(root, "packages", "ui", "src", "Button.tsx"), "export const B = 1;\n");
    writeFileSync(path.join(root, "src", "icon.svg"), "<svg></svg>\n");
    writeFileSync(path.join(root, "src", "i18n.json"), "{}\n");
    const files = collectStorybookInputFiles(root).map(file => path.relative(root, file));
    expect(files.some(file => file.includes(`${path.join("packages", "ui", "src", "Button.tsx")}`))).toBe(true);
    expect(files).toContain(path.join("src", "icon.svg"));
    expect(files).toContain(path.join("src", "i18n.json"));
  });
});

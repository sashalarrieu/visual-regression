import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { filesToNudgeFromDiff, nudgeFsWatchers, startStorybookKeepFresh } from "./vr-storybook-keep-fresh";
import {
  diffStorybookInputSnapshots,
  snapshotStorybookInputStats,
  snapshotStorybookInputs,
} from "./vr-storybook-runtime";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const tmpProject = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "vr-keep-fresh-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const A = {};\n");
  return root;
};

describe("storybook keep-fresh", () => {
  afterEach(() => {
    delete process.env.VR_DOCKER;
  });

  it("diffs added and changed files", () => {
    const root = tmpProject();
    const before = snapshotStorybookInputs(root);
    writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const B = {};\n");
    writeFileSync(path.join(root, "src", "New.stories.tsx"), "export const C = {};\n");
    const diff = diffStorybookInputSnapshots(before, snapshotStorybookInputs(root));
    expect(diff.changed.some(file => file.endsWith("Button.stories.tsx"))).toBe(true);
    expect(diff.added.some(file => file.endsWith("New.stories.tsx"))).toBe(true);
    expect(filesToNudgeFromDiff(diff).length).toBe(diff.changed.length + diff.added.length);
  });

  it("nudges mtime so inotify can see a host-invisible save", async () => {
    const root = tmpProject();
    const file = path.join(root, "src", "Button.stories.tsx");
    const before = statSync(file).mtimeMs;
    await sleep(20);
    nudgeFsWatchers([file]);
    expect(statSync(file).mtimeMs).toBeGreaterThan(before);
  });

  it("calls onStaticChange after a source edit", async () => {
    const root = tmpProject();
    let calls = 0;
    const handle = startStorybookKeepFresh({
      projectRoot: root,
      mode: "static",
      intervalMs: 40,
      debounceMs: 30,
      onDevChange: async () => undefined,
      onStaticChange: async () => {
        calls += 1;
      },
    });
    await sleep(80);
    writeFileSync(path.join(root, "src", "Button.stories.tsx"), "export const Edited = {};\n");
    await sleep(350);
    handle.stop();
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("detects edits via mtime+size without hashing contents", async () => {
    const root = tmpProject();
    const file = path.join(root, "src", "Button.stories.tsx");
    const before = snapshotStorybookInputStats([file]);
    await sleep(20);
    writeFileSync(file, "export const Edited = {};\n");
    const after = snapshotStorybookInputStats([file]);
    const diff = diffStorybookInputSnapshots(before, after);
    expect(diff.changed).toEqual([file]);
  });
});

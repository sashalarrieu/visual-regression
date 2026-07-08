import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FORCE_VR_TAG } from "@constants/constants";
import type { CaptureTask } from "@scripts/vr-capture-engine";
import { createTestVrConfig } from "@utils/test-helpers";
import { resolveAffectedStoryIds } from "@utils/vr-dependency-graph";
import {
  filterCaptureTasks,
  getChangedFilesFromGit,
  getGlobalTriggerMatches,
  isGlobalTrigger,
  shouldWipePublicDir,
  type StoryIndexEntry,
} from "@utils/vr-incremental";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("@utils/vr-dependency-graph", () => ({
  resolveAffectedStoryIds: vi.fn(() => new Set(["demo-button--primary"])),
}));

const mockedExecSync = vi.mocked(execSync);
const mockedResolveAffectedStoryIds = vi.mocked(resolveAffectedStoryIds);

const task = (storyId: string, componentDir = "src/demo/components/DemoButton"): CaptureTask => ({
  storyId,
  deviceName: "desktop-fhd",
  componentDir,
});

const stories: StoryIndexEntry[] = [
  {
    id: "demo-button--primary",
    importPath: "src/demo/components/DemoButton/DemoButton.stories.tsx",
  },
  {
    id: "demo-card--default",
    importPath: "src/demo/components/DemoCard/DemoCard.stories.tsx",
  },
];

const tmpRoot = path.join(process.cwd(), ".vr-test-tmp");

afterEach(() => {
  mockedExecSync.mockReset();
  mockedResolveAffectedStoryIds.mockReset();
  mockedResolveAffectedStoryIds.mockReturnValue(new Set(["demo-button--primary"]));
  if (existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("getChangedFilesFromGit", () => {
  it("aggregates branch and working tree changes", () => {
    mockedExecSync.mockImplementation((command: string) => {
      if (command.includes("diff --name-only origin/main...HEAD")) return "src/demo/Button.tsx\n";
      if (command.includes("diff --name-only HEAD")) return "src/demo/Card.tsx\n";
      if (command.includes("diff --name-only --cached")) return "package.json\n";
      if (command.includes("ls-files --others")) return "src/demo/New.tsx\n";
      return "";
    });

    const files = getChangedFilesFromGit(process.cwd(), createTestVrConfig());
    expect(files).toEqual(
      expect.arrayContaining(["src/demo/Button.tsx", "src/demo/Card.tsx", "package.json", "src/demo/New.tsx"]),
    );
  });
});

describe("global triggers", () => {
  it("matches configured trigger patterns", () => {
    const config = createTestVrConfig();
    const changed = ["package.json", "src/demo/Button.tsx"];
    expect(getGlobalTriggerMatches(changed, config)).toEqual(["package.json"]);
    expect(isGlobalTrigger(changed, config)).toBe(true);
    expect(isGlobalTrigger(["src/demo/Button.tsx"], config)).toBe(false);
  });
});

describe("filterCaptureTasks", () => {
  const allTasks = [
    task("demo-button--primary", "src/demo/components/DemoButton"),
    task("demo-card--default", "src/demo/components/DemoCard"),
  ];

  it("returns all tasks in full mode", () => {
    const config = createTestVrConfig({ compare: { ...createTestVrConfig().compare, mode: "full" } });
    const result = filterCaptureTasks(allTasks, config, stories, {
      projectRoot: tmpRoot,
      publicScreenshotsDir: path.join(tmpRoot, "public", "Screenshots"),
      changedFiles: { files: [], source: "git" },
    });
    expect(result).toEqual({ tasks: allTasks, skipped: 0, reason: "full" });
  });

  it("returns all tasks when requiresFullRun is set", () => {
    const config = createTestVrConfig();
    const result = filterCaptureTasks(allTasks, config, stories, {
      projectRoot: tmpRoot,
      publicScreenshotsDir: path.join(tmpRoot, "public", "Screenshots"),
      changedFiles: { files: [], source: "none", requiresFullRun: true },
    });
    expect(result.reason).toBe("requires-full-run");
    expect(result.tasks).toHaveLength(allTasks.length);
  });

  it("returns all tasks on global trigger", () => {
    const config = createTestVrConfig();
    const result = filterCaptureTasks(allTasks, config, stories, {
      projectRoot: tmpRoot,
      publicScreenshotsDir: path.join(tmpRoot, "public", "Screenshots"),
      changedFiles: { files: ["package.json"], source: "git" },
    });
    expect(result.reason).toBe("global-trigger");
    expect(result.tasks).toHaveLength(allTasks.length);
  });

  it("keeps force-vr stories and affected incremental tasks", () => {
    const config = createTestVrConfig();
    const forceStory: StoryIndexEntry = {
      id: "demo-spinner--default",
      importPath: "src/demo/components/DemoSpinner/DemoSpinner.stories.tsx",
      tags: [FORCE_VR_TAG],
    };
    const tasks = [...allTasks, task("demo-spinner--default", "src/demo/components/DemoSpinner")];

    mkdirSync(path.join(tmpRoot, "src/demo/components/DemoButton", "Screenshots"), { recursive: true });
    mkdirSync(path.join(tmpRoot, "src/demo/components/DemoCard", "Screenshots"), { recursive: true });
    mkdirSync(path.join(tmpRoot, "src/demo/components/DemoSpinner", "Screenshots"), { recursive: true });
    writeFileSync(
      path.join(tmpRoot, "src/demo/components/DemoButton/Screenshots/desktop-fhd-demo-button--primary.screenshot.png"),
      "baseline",
    );
    writeFileSync(
      path.join(tmpRoot, "src/demo/components/DemoCard/Screenshots/desktop-fhd-demo-card--default.screenshot.png"),
      "baseline",
    );
    writeFileSync(
      path.join(
        tmpRoot,
        "src/demo/components/DemoSpinner/Screenshots/desktop-fhd-demo-spinner--default.screenshot.png",
      ),
      "baseline",
    );

    const result = filterCaptureTasks(tasks, config, [...stories, forceStory], {
      projectRoot: tmpRoot,
      publicScreenshotsDir: path.join(tmpRoot, "public", "Screenshots"),
      changedFiles: { files: ["src/demo/components/DemoButton/DemoButton.tsx"], source: "git" },
    });

    expect(result.reason).toBe("incremental");
    expect(result.tasks.map(t => t.storyId)).toEqual(
      expect.arrayContaining(["demo-button--primary", "demo-spinner--default"]),
    );
    expect(result.tasks.some(t => t.storyId === "demo-card--default")).toBe(false);
    expect(result.skipped).toBe(1);
  });
});

describe("shouldWipePublicDir", () => {
  it("wipes on full mode or global trigger", () => {
    const config = createTestVrConfig();
    expect(shouldWipePublicDir(config, { tasks: [], skipped: 0, reason: "global-trigger" })).toBe(true);
    expect(
      shouldWipePublicDir(createTestVrConfig({ compare: { ...config.compare, mode: "full" } }), {
        tasks: [],
        skipped: 0,
        reason: "incremental",
      }),
    ).toBe(true);
    expect(shouldWipePublicDir(config, { tasks: [], skipped: 0, reason: "incremental" })).toBe(false);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureErrorKey,
  getCaptureErrorsPath,
  readCaptureErrors,
  syncCaptureErrorsAfterBatch,
  syncCaptureErrorsAllFailed,
  syncCaptureErrorsFromBatch,
  writeCaptureErrors,
} from "./vr-capture-errors";

const tempDirs: string[] = [];

const makeTempRoot = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "vr-capture-errors-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("vr-capture-errors", () => {
  it("captureErrorKey is stable", () => {
    expect(captureErrorKey("demo-button--primary", "mobile")).toBe("mobile::demo-button--primary");
  });

  it("readCaptureErrors returns [] when missing", () => {
    expect(readCaptureErrors(makeTempRoot())).toEqual([]);
  });

  it("write / read round-trip", () => {
    const root = makeTempRoot();
    writeCaptureErrors(root, [
      {
        storyId: "a--b",
        deviceName: "desktop",
        componentDir: "src/a",
        message: "timeout",
        at: 1,
      },
    ]);
    expect(readCaptureErrors(root)).toEqual([
      {
        storyId: "a--b",
        deviceName: "desktop",
        componentDir: "src/a",
        message: "timeout",
        at: 1,
      },
    ]);
    expect(JSON.parse(readFileSync(getCaptureErrorsPath(root), "utf8")).items).toHaveLength(1);
  });

  it("syncCaptureErrorsFromBatch removes successes and upserts failures", () => {
    const root = makeTempRoot();
    writeCaptureErrors(root, [
      {
        storyId: "old--x",
        deviceName: "mobile",
        componentDir: "src/old",
        message: "stale",
        at: 1,
      },
      {
        storyId: "keep--y",
        deviceName: "tablet",
        componentDir: "src/keep",
        message: "untouched",
        at: 2,
      },
    ]);

    const next = syncCaptureErrorsFromBatch(
      root,
      [
        { storyId: "old--x", deviceName: "mobile", componentDir: "src/old" },
        { storyId: "new--z", deviceName: "desktop", componentDir: "src/new" },
      ],
      [
        {
          storyId: "new--z",
          deviceName: "desktop",
          componentDir: "src/new",
          message: "boom",
          at: 99,
        },
      ],
    );

    expect(next).toEqual([
      {
        storyId: "keep--y",
        deviceName: "tablet",
        componentDir: "src/keep",
        message: "untouched",
        at: 2,
      },
      {
        storyId: "new--z",
        deviceName: "desktop",
        componentDir: "src/new",
        message: "boom",
        at: 99,
      },
    ]);
  });

  it("syncCaptureErrorsAfterBatch only touches resolved keys", () => {
    const root = makeTempRoot();
    writeCaptureErrors(root, [
      {
        storyId: "a--1",
        deviceName: "mobile",
        componentDir: "src/a",
        message: "err-a",
        at: 1,
      },
      {
        storyId: "b--2",
        deviceName: "mobile",
        componentDir: "src/b",
        message: "err-b",
        at: 2,
      },
    ]);

    const next = syncCaptureErrorsAfterBatch(root, {
      succeeded: [{ storyId: "a--1", deviceName: "mobile" }],
      failed: [
        {
          storyId: "c--3",
          deviceName: "desktop",
          componentDir: "src/c",
          message: "err-c",
          at: 3,
        },
      ],
    });

    expect(next.map(i => `${i.deviceName}::${i.storyId}`)).toEqual(["mobile::b--2", "desktop::c--3"]);
  });

  it("syncCaptureErrorsAllFailed marks every attempted task", () => {
    const root = makeTempRoot();
    const next = syncCaptureErrorsAllFailed(
      root,
      [
        { storyId: "a--1", deviceName: "mobile", componentDir: "src/a" },
        { storyId: "b--2", deviceName: "desktop", componentDir: "src/b" },
      ],
      "daemon down",
    );
    expect(next).toHaveLength(2);
    expect(next.every(item => item.message === "daemon down")).toBe(true);
  });
});

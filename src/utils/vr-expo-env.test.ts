import { describe, expect, it } from "vitest";

import { getExpoSpawnEnv } from "./vr-expo-env";

describe("getExpoSpawnEnv", () => {
  it("sert assets/ comme dossier public Expo (favicons à la racine web)", () => {
    const env = getExpoSpawnEnv({ ...process.env, FOO: "1" }, "/tmp/host");
    expect(env.EXPO_PUBLIC_FOLDER).toBe("assets");
    expect(env.VR_PROJECT_ROOT).toBe("/tmp/host");
    expect(env.FOO).toBe("1");
  });
});

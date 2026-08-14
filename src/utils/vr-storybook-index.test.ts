import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchStorybookIndexEntries,
  getStorybookIndexCacheForTests,
  resetStorybookIndexCache,
} from "./vr-storybook-index";

const STORYBOOK_URL = "http://localhost:16840";

const sampleEntries = {
  "demo--default": {
    id: "demo--default",
    type: "story",
    importPath: "src/demo/Demo.stories.tsx",
    tags: [],
  },
};

describe("fetchStorybookIndexEntries", () => {
  afterEach(() => {
    resetStorybookIndexCache();
    vi.unstubAllGlobals();
  });

  it("met en cache un index.json valide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entries: sampleEntries }),
      }),
    );

    const entries = await fetchStorybookIndexEntries(STORYBOOK_URL, { retries: 1 });
    expect(entries).toEqual(sampleEntries);
    expect(getStorybookIndexCacheForTests().get(STORYBOOK_URL)?.entries).toEqual(sampleEntries);
  });

  it("renvoie le cache sans warn quand Storybook est temporairement down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ entries: sampleEntries }),
        })
        .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
    );

    await fetchStorybookIndexEntries(STORYBOOK_URL, { retries: 1 });
    const entries = await fetchStorybookIndexEntries(STORYBOOK_URL, { retries: 1 });

    expect(entries).toEqual(sampleEntries);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reste silencieux sans cache sur erreur réseau transitoire (rebuild Storybook)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })),
    );

    const entries = await fetchStorybookIndexEntries(STORYBOOK_URL, { retries: 1, retryDelayMs: 0 });

    expect(entries).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("retry puis succès sans warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ entries: sampleEntries }),
        }),
    );

    const entries = await fetchStorybookIndexEntries(STORYBOOK_URL, { retries: 2, retryDelayMs: 0 });

    expect(entries).toEqual(sampleEntries);
    expect(warn).not.toHaveBeenCalled();
  });
});

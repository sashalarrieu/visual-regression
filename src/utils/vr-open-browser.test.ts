import { describe, expect, it } from "vitest";

import { normalizeBrowserOrigin } from "./vr-open-browser";

describe("normalizeBrowserOrigin", () => {
  it("normalise localhost et strip le path", () => {
    expect(normalizeBrowserOrigin("http://localhost:2804/foo?x=1")).toBe("http://localhost:2804");
  });

  it("traite 127.0.0.1 comme localhost", () => {
    expect(normalizeBrowserOrigin("http://127.0.0.1:6006")).toBe("http://localhost:6006");
  });

  it("conserve le protocole https", () => {
    expect(normalizeBrowserOrigin("https://localhost:2804")).toBe("https://localhost:2804");
  });

  it("retourne null pour une URL invalide", () => {
    expect(normalizeBrowserOrigin("not-a-url")).toBeNull();
  });
});

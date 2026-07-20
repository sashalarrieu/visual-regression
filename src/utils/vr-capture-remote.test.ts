import path from "path";

import { describe, expect, it } from "vitest";

import { isCaptureDaemonReusableForProject, type CaptureDaemonHealth } from "./vr-capture-remote";
import { getComposeProjectName } from "./vr-docker";

describe("isCaptureDaemonReusableForProject", () => {
  const projectRoot = "/Users/me/Documents/dev/EIWIE_PRO_FRONTEND";

  it("refuse un health null ou non prêt", () => {
    expect(isCaptureDaemonReusableForProject(null, projectRoot)).toBe(false);
    expect(isCaptureDaemonReusableForProject({ ready: false, hostProjectRoot: projectRoot }, projectRoot)).toBe(false);
  });

  it("refuse un vieux daemon sans hostProjectRoot", () => {
    const health: CaptureDaemonHealth = { ready: true };
    expect(isCaptureDaemonReusableForProject(health, projectRoot)).toBe(false);
  });

  it("refuse un sidecar d'un autre projet", () => {
    const health: CaptureDaemonHealth = {
      ready: true,
      hostProjectRoot: "/Users/me/Documents/dev/eiwie-frontend-apps",
    };
    expect(isCaptureDaemonReusableForProject(health, projectRoot)).toBe(false);
  });

  it("accepte le même projet (chemins résolus)", () => {
    const health: CaptureDaemonHealth = {
      ready: true,
      hostProjectRoot: `${projectRoot}/`,
    };
    expect(isCaptureDaemonReusableForProject(health, projectRoot)).toBe(true);
  });
});

describe("getComposeProjectName", () => {
  it("produit un nom stable et distinct par racine", () => {
    const pro = getComposeProjectName("/Users/me/Documents/dev/EIWIE_PRO_FRONTEND");
    const apps = getComposeProjectName("/Users/me/Documents/dev/eiwie-frontend-apps");
    expect(pro).toMatch(/^vr-eiwie_pro_frontend-[a-f0-9]{8}$/);
    expect(apps).toMatch(/^vr-eiwie-frontend-apps-[a-f0-9]{8}$/);
    expect(pro).not.toBe(apps);
    expect(getComposeProjectName(path.join("/Users/me/Documents/dev", "EIWIE_PRO_FRONTEND"))).toBe(pro);
  });
});

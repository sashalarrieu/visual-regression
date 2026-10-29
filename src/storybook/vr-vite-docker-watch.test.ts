import { afterEach, describe, expect, it } from "vitest";

import { applyVrDockerViteWatch, VR_VITE_WATCH_IGNORED } from "./vr-vite-docker-watch";

describe("applyVrDockerViteWatch", () => {
  const originalDocker = process.env.VR_DOCKER;

  afterEach(() => {
    if (originalDocker === undefined) delete process.env.VR_DOCKER;
    else process.env.VR_DOCKER = originalDocker;
  });

  it("always ignores storybook-static so host yarn storybook does not reload VR iframe.html", () => {
    delete process.env.VR_DOCKER;
    const config = applyVrDockerViteWatch({
      server: {} as { host?: string; watch?: { ignored?: unknown; usePolling?: boolean; interval?: number } },
    });
    expect(config.server.watch?.ignored).toEqual(expect.arrayContaining([...VR_VITE_WATCH_IGNORED]));
    expect(config.server.watch?.usePolling).toBeUndefined();
  });

  it("enables polling only inside the Docker sidecar", () => {
    process.env.VR_DOCKER = "1";
    const config = applyVrDockerViteWatch({
      server: {} as { host?: string; watch?: { ignored?: unknown; usePolling?: boolean; interval?: number } },
    });
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.server.watch?.usePolling).toBe(true);
    expect(config.server.watch?.interval).toBe(200);
  });
});

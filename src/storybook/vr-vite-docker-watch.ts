/**
 * Vite / Storybook dans le sidecar Docker Desktop : inotify ne voit pas les
 * saves de l'hôte. Forcer le polling (Vite 6 ignore CHOKIDAR_USEPOLLING).
 *
 * Toujours ignorer `storybook-static` : un `yarn storybook` hôte ne doit pas
 * full-reload `iframe.html` écrit par un build static VR (OOM).
 */
export const VR_VITE_WATCH_IGNORED = ["**/storybook-static/**", "**/.vr-cache/**"] as const;

const mergeWatchIgnored = (existing: unknown): unknown[] => {
  const extras = [...VR_VITE_WATCH_IGNORED];
  if (existing == null) return extras;
  if (Array.isArray(existing)) return [...existing, ...extras];
  return [existing, ...extras];
};

export const applyVrDockerViteWatch = <T extends { server?: Record<string, unknown> }>(config: T): T => {
  const server = { ...(config.server ?? {}) };
  const watch = { ...((server.watch as Record<string, unknown> | undefined) ?? {}) };
  const isDocker = process.env.VR_DOCKER === "1";
  config.server = {
    ...server,
    ...(isDocker ? { host: server.host ?? "0.0.0.0" } : {}),
    watch: {
      ...watch,
      ignored: mergeWatchIgnored(watch.ignored),
      ...(isDocker ? { usePolling: true, interval: 200 } : {}),
    },
  };
  return config;
};

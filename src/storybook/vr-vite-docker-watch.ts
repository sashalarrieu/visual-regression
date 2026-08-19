/**
 * Vite / Storybook dans le sidecar Docker Desktop : inotify ne voit pas les
 * saves de l'hôte. Forcer le polling (Vite 6 ignore CHOKIDAR_USEPOLLING).
 */
export const applyVrDockerViteWatch = <T extends { server?: Record<string, unknown> }>(config: T): T => {
  if (process.env.VR_DOCKER !== "1") return config;
  const server = { ...(config.server ?? {}) };
  const watch = { ...((server.watch as Record<string, unknown> | undefined) ?? {}) };
  config.server = {
    ...server,
    host: server.host ?? "0.0.0.0",
    watch: {
      ...watch,
      usePolling: true,
      interval: 200,
    },
  };
  return config;
};

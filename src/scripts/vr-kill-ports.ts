/**
 * Libère les ports VR du projet courant (Expo, serveur UI, Storybook/daemon dérivés).
 * N'arrête pas les sidecars Docker des autres projets.
 *
 * Usage : visual-regression kill-ports
 */
import { spawnSync } from "child_process";
import path from "path";

import { CAPTURE_DAEMON_PORT, EXPO_PORT, STORYBOOK_PORT, VR_SERVER_PORT } from "../constants/constants";
import { getProjectRoot, resolveVrConfig } from "../utils/node";
import { parseUrlPort } from "../utils/vr-sidecar-ports";

const PROJECT_ROOT = getProjectRoot();

const config = resolveVrConfig(PROJECT_ROOT);
const storybookPort = parseUrlPort(config.storybook.url, STORYBOOK_PORT);
const daemonPort = parseUrlPort(config.capture.daemonUrl, CAPTURE_DAEMON_PORT);

const ports = [...new Set([EXPO_PORT, VR_SERVER_PORT, storybookPort, daemonPort])];

console.log(`🔪 Libération des ports du projet (${path.basename(PROJECT_ROOT)}) : ${ports.join(", ")}`);

const isWin = process.platform === "win32";
const result = spawnSync(isWin ? "npx.cmd" : "npx", ["kill-port", ...ports.map(String)], {
  stdio: "inherit",
  shell: isWin,
  cwd: PROJECT_ROOT,
});

process.exit(result.status ?? 1);

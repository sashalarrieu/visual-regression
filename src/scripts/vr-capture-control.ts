/**
 * Contrôle du sidecar Docker de capture depuis l'hôte.
 * Usage : vr-capture-control.ts <up|down|status>
 *   - up     : démarre le conteneur puis attend que le daemon soit prêt
 *   - down   : arrête le conteneur
 *   - status : affiche l'état compose + le health du daemon
 */
import { LOG_COLORS } from "../constants/constants";
import { getProjectRoot } from "../utils/node";
import { getCaptureDaemonUrl } from "../utils/vr-capture-backend";
import { waitForCaptureDaemon } from "../utils/vr-capture-remote";
import { composeDown, composeStatus, composeUp, isDockerAvailable } from "../utils/vr-docker";

const PROJECT_ROOT = getProjectRoot();

const log = (color: keyof typeof LOG_COLORS, prefix: string, message: string): void => {
  console.log(`${LOG_COLORS[color]}${prefix}${LOG_COLORS.reset} ${message}`);
};

const ensureDocker = (): void => {
  if (!isDockerAvailable()) {
    log("red", "❌", "Docker n'est pas disponible. Installez Docker pour la capture VR.");
    process.exit(1);
  }
};

const up = async (): Promise<void> => {
  ensureDocker();
  log("blue", "🐳", "Démarrage du sidecar de capture");
  const code = await composeUp(PROJECT_ROOT);
  if (code !== 0) {
    log("red", "❌", `docker compose up a échoué (code ${code})`);
    process.exit(code);
  }
  log("blue", "⏳", "Attente du daemon de capture (le 1er build Storybook peut être long)");
  const ready = await waitForCaptureDaemon(300);
  if (!ready) {
    log("red", "❌", `Daemon injoignable sur ${getCaptureDaemonUrl()}`);
    process.exit(1);
  }
  log("green", "✅", `Sidecar prêt (${getCaptureDaemonUrl()})`);
};

const down = async (): Promise<void> => {
  ensureDocker();
  log("blue", "🐳", "Arrêt du sidecar de capture");
  const code = await composeDown(PROJECT_ROOT);
  process.exit(code);
};

const status = async (): Promise<void> => {
  ensureDocker();
  await composeStatus(PROJECT_ROOT);
  try {
    const res = await fetch(`${getCaptureDaemonUrl()}/health`);
    const body = await res.json();
    log("blue", "🩺", `Daemon health: ${JSON.stringify(body)}`);
  } catch {
    log("yellow", "⚠️", `Daemon injoignable sur ${getCaptureDaemonUrl()}`);
  }
};

const action = process.argv[2];

const main = async (): Promise<void> => {
  switch (action) {
    case "up":
      await up();
      break;
    case "down":
      await down();
      break;
    case "status":
      await status();
      break;
    default:
      log("red", "❌", `Action inconnue: ${action ?? "(vide)"} (attendu: up|down|status)`);
      process.exit(1);
  }
};

main().catch(err => {
  log("red", "❌", `Erreur: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

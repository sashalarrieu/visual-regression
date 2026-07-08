#!/usr/bin/env node
/**
 * Point d'entrée CLI pour @setshao/visual-regression.
 * À lancer depuis la racine du projet hôte (où se trouve vr.config.cjs).
 *
 * Usage:
 *   visual-regression           → lance tout (serveur + Storybook + Expo + compare incrémentale)
 *   visual-regression server     → uniquement le serveur VR (vr:server)
 *   visual-regression compare    → uniquement la comparaison (vr:compare)
 *   visual-regression app        → uniquement l'interface Web VR (vr:app)
 *   visual-regression benchmark [max] → benchmark concurrency 1..max (défaut 16, vr:benchmark)
 *   visual-regression benchmark-shards [opts] → simulation sharding CI (vr:benchmark-shards)
 *   visual-regression test-incremental [--check-only] → vérifie TurboSnap puis compare (vr:test-incremental)
 *   visual-regression test-validation [--static-only] → checklist Phases 0–8 (vr:test-validation)
 *   visual-regression capture-up       → démarre le sidecar Docker de capture (vr:capture:up)
 *   visual-regression capture-down     → arrête le sidecar Docker (vr:capture:down)
 *   visual-regression capture-status   → état du sidecar + health daemon (vr:capture:status)
 *   visual-regression capture-daemon   → (interne conteneur) daemon de capture
 *   visual-regression capture-oneshot  → (interne conteneur) capture one-shot CI
 *
 * Env utiles :
 *   VR_RUN_INITIAL_COMPARE=0    → yarn vr sans compare initiale (rebuild index seulement)
 *   VR_SHARD_INDEX=0 VR_SHARD_TOTAL=4 → shard CI pour vr:compare
 *   VR_STORYBOOK_STATIC=1       → Storybook build + serve au lieu de dev (yarn vr)
 *   VR_STORYBOOK_STATIC_REBUILD=1 → force rebuild storybook-static au lancement
 */
import { spawn } from "child_process";
import { existsSync, realpathSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
/** Racine réelle du package (sans symlink) pour que Expo ne soit pas sous node_modules → Babel s'applique. */
const packageRootReal = realpathSync(packageRoot);
const hostRoot = process.cwd();
const configPath = path.join(hostRoot, "vr.config.cjs");
const legacyConfigPath = path.join(hostRoot, "vr-devices.config.cjs");

if (!existsSync(configPath)) {
  if (existsSync(legacyConfigPath)) {
    console.error(
      "\n❌ Fichier de configuration requis manquant : vr.config.cjs\n" +
        "   Ancien fichier détecté : vr-devices.config.cjs\n" +
        "   Renommez-le en vr.config.cjs et enveloppez les devices dans un objet :\n" +
        "   module.exports = { devices: [ /* vos devices */ ] };\n",
    );
  } else {
    console.error(
      "\n❌ Fichier de configuration requis manquant : vr.config.cjs\n" +
        `   Créez ce fichier à la racine de votre projet (${hostRoot}).\n` +
        "   Voir la documentation : https://github.com/setshao/visual-regression#readme\n",
    );
  }
  process.exit(1);
}

const subcommand = process.argv[2];
const EXPO_PORT = 2804;
const env = { ...process.env, VR_PROJECT_ROOT: hostRoot };
const isWin = process.platform === "win32";
const npxRunner = isWin ? "npx.cmd" : "npx";
/** Sur Windows, Node 20.12+ exige shell: true pour spawn des .cmd (EINVAL sinon). */
const spawnOpts = (cwd, envOverrides = {}) => ({
  cwd,
  env: { ...env, ...envOverrides },
  stdio: "inherit",
  ...(isWin && { shell: true }),
});

/** Chemin vers le CLI tsx (évite "tsx non reconnu" avec npx + shell sur Windows). */
function getTsxCliPath() {
  const candidates = [
    path.join(packageRootReal, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(hostRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let scriptPath;
/** Arguments supplémentaires passés au script tsx (ex. benchmark 12). */
let scriptArgs = [];
switch (subcommand) {
  case "server": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-server.ts");
    break;
  }
  case "compare": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "compare-visual-regressions.ts");
    break;
  }
  case "benchmark": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-benchmark-concurrency.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "benchmark-shards": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-benchmark-shards.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "test-incremental": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-test-incremental.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "test-validation": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-test-validation.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "capture-daemon": {
    // Daemon de capture (exécuté DANS le conteneur). cwd = projet hôte (/work).
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-capture-daemon.ts");
    break;
  }
  case "capture-oneshot": {
    // Capture one-shot (CI, DANS le conteneur). cwd = projet hôte (/work).
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-capture-oneshot.ts");
    break;
  }
  case "capture-up":
  case "capture-down":
  case "capture-status": {
    // Contrôle du sidecar Docker depuis l'hôte.
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-capture-control.ts");
    scriptArgs = [subcommand.replace("capture-", "")];
    break;
  }
  case "app": {
    // Interface web VR (Expo). Ne pas forcer CI=1 : Metro désactive le hot reload en mode CI.
    const expoArgs = ["expo", "start", "--web", "--port", String(EXPO_PORT)];
    if (process.env.VR_CLEAR_METRO === "1") {
      expoArgs.push("--clear");
    }
    const child = spawn(npxRunner, expoArgs, spawnOpts(packageRootReal));
    child.on("error", err => {
      console.error("❌ Impossible de lancer l'interface VR:", err.message);
      process.exit(1);
    });
    child.on("exit", code => process.exit(code ?? 0));
    break;
  }
  default: {
    // pas d'argument ou "start" → launcher complet
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-launcher.ts");
    break;
  }
}

if (scriptPath) {
  const tsxCli = getTsxCliPath();
  const useNpxFallback = !tsxCli;
  // compare, server et benchmark s'exécutent avec cwd = racine du projet hôte.
  const hostCwdSubcommands = new Set([
    "compare",
    "server",
    "benchmark",
    "benchmark-shards",
    "test-incremental",
    "test-validation",
    "capture-daemon",
    "capture-oneshot",
    "capture-up",
    "capture-down",
    "capture-status",
  ]);
  const cwd = hostCwdSubcommands.has(subcommand) ? hostRoot : packageRootReal;
  const child = tsxCli
    ? spawn("node", [tsxCli, scriptPath, ...scriptArgs], {
        ...spawnOpts(cwd),
        shell: false,
      })
    : spawn(
        npxRunner,
        ["tsx", scriptPath, ...scriptArgs],
        spawnOpts(hostRoot),
      );
  child.on("error", err => {
    console.error("❌ Impossible de lancer visual-regression:", err.message);
    if (useNpxFallback) {
      console.error(
        "   Ajoutez tsx au projet hôte: yarn add -D tsx (dans vow-frontend)\n" +
          "   ou installez dans le package: cd visual-regression && yarn install",
      );
    }
    process.exit(1);
  });
  child.on("exit", code => process.exit(code ?? 0));
}

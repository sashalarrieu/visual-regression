#!/usr/bin/env node
/**
 * Point d'entrée CLI pour @setshao/visual-regression.
 * À lancer depuis la racine du projet hôte (où se trouve vr-devices.config.cjs).
 *
 * Usage:
 *   visual-regression           → lance tout (serveur + Storybook + Expo + comparaison)
 *   visual-regression server     → uniquement le serveur VR (vr:server)
 *   visual-regression compare    → uniquement la comparaison (vr:compare)
 *   visual-regression app        → uniquement l'interface Web VR (vr:app)
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
const configPath = path.join(hostRoot, "vr-devices.config.cjs");

if (!existsSync(configPath)) {
  console.error(
    "\n❌ Fichier de configuration requis manquant : vr-devices.config.cjs\n" +
      `   Créez ce fichier à la racine de votre projet (${hostRoot}).\n` +
      "   Voir la documentation : https://github.com/setshao/visual-regression#readme\n",
  );
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
switch (subcommand) {
  case "server": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "vr-server.ts");
    break;
  }
  case "compare": {
    scriptPath = path.join(packageRootReal, "src", "scripts", "compare-visual-regressions.ts");
    break;
  }
  case "app": {
    // Ouvre l'interface web de régression visuelle (composant VisualRegressions, src/index.tsx)
    // cwd = racine réelle du package pour que le projet ne soit pas sous node_modules → pas d'exclusion Babel
    const child = spawn(
      npxRunner,
      ["expo", "start", "--web", "--clear", "--port", String(EXPO_PORT)],
      spawnOpts(packageRootReal),
    );
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
  // compare (et server) doivent s'exécuter avec cwd = racine du projet hôte pour que
  // Storybook buildIndex() résolve correctement les stories (configDir + glob ../src/...).
  const cwd = subcommand === "compare" || subcommand === "server" ? hostRoot : packageRootReal;
  const child = tsxCli
    ? spawn("node", [tsxCli, scriptPath], {
        ...spawnOpts(cwd),
        shell: false,
      })
    : spawn(
        npxRunner,
        ["tsx", scriptPath],
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

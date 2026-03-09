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

let scriptArgs;
switch (subcommand) {
  case "server": {
    scriptArgs = ["run", path.join(packageRoot, "src", "scripts", "vr-server.ts")];
    break;
  }
  case "compare": {
    scriptArgs = ["run", path.join(packageRoot, "src", "scripts", "compare-visual-regressions.ts")];
    break;
  }
  case "app": {
    // Ouvre l'interface web de régression visuelle (composant VisualRegressions, src/index.tsx)
    // cwd = racine réelle du package pour que le projet ne soit pas sous node_modules → pas d'exclusion Babel
    const isWin = process.platform === "win32";
    const runner = isWin ? "npx.cmd" : "npx";
    const child = spawn(
      runner,
      ["expo", "start", "--web", "--clear", "--port", String(EXPO_PORT)],
      {
        cwd: packageRootReal,
        env,
        stdio: "inherit",
      },
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
    scriptArgs = ["run", path.join(packageRoot, "src", "scripts", "vr-launcher.ts")];
    break;
  }
}

if (scriptArgs) {
  const child = spawn("bun", scriptArgs, {
    cwd: packageRootReal,
    env,
    stdio: "inherit",
  });
  child.on("error", err => {
    console.error("❌ Impossible de lancer visual-regression:", err.message);
    console.error("   Vérifiez que Bun est installé (https://bun.sh)");
    process.exit(1);
  });
  child.on("exit", code => process.exit(code ?? 0));
}

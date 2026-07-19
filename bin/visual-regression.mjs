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
 *   visual-regression kill-ports       → libère Expo/UI + ports Storybook/daemon de ce projet
 *   visual-regression capture-daemon   → (interne conteneur) daemon de capture
 *   visual-regression capture-oneshot  → (interne conteneur) capture one-shot CI
 *
 * Env utiles :
 *   VR_RUN_INITIAL_COMPARE=0    → yarn vr sans compare initiale (rebuild index seulement)
 *   VR_SHARD_INDEX=0 VR_SHARD_TOTAL=4 → shard CI pour vr:compare
 *   VR_STORYBOOK_MODE=static|dev  → Storybook build+serve ou dev (yarn vr)
 *   VR_STORYBOOK_STATIC=1         → alias de VR_STORYBOOK_MODE=static (rétrocompat)
 *   VR_STORYBOOK_STATIC_REBUILD=1 → force rebuild storybook-static au lancement
 */
import { spawn } from "child_process";
import { cpSync, existsSync, readFileSync, realpathSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getExpoSpawnEnv } from "./expo-env.mjs";
import { getTsxCliPath, spawnTsxScript } from "./spawn-tsx.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const hostRoot = process.cwd();
/** Racine réelle du package installé (sans symlink). */
const installedPackageRoot = realpathSync(packageRoot);

/** Copie installée dans node_modules du projet hôte (deps npm/yarn). */
const resolveInstalledCopyRoot = root => {
  const installedCopy = path.join(root, "node_modules", "@setshao", "visual-regression");
  const launcher = path.join(installedCopy, "src", "scripts", "vr-launcher.ts");
  if (!existsSync(launcher)) return null;
  try {
    return realpathSync(installedCopy);
  } catch {
    return installedCopy;
  }
};

/** Avec `file:`, détecte la source liée du package. */
const resolveLinkedPackageRoot = root => {
  const consumerPkgPath = path.join(root, "package.json");
  if (!existsSync(consumerPkgPath)) return null;
  try {
    const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, "utf8"));
    const depSpec =
      consumerPkg.dependencies?.["@setshao/visual-regression"] ??
      consumerPkg.devDependencies?.["@setshao/visual-regression"];
    if (typeof depSpec === "string" && depSpec.startsWith("file:")) {
      const linkedSource = path.resolve(root, depSpec.slice("file:".length));
      const launcher = path.join(linkedSource, "src", "scripts", "vr-launcher.ts");
      if (existsSync(launcher)) return linkedSource;
    }
  } catch {
    // ignore
  }
  return null;
};

/** Synchronise src/ + bin/ depuis la source `file:` vers la copie node_modules (yarn copie figée). */
const syncLinkedSourcesToInstalledCopy = (linkedRoot, installedRoot) => {
  const linkedLauncher = path.join(linkedRoot, "src", "scripts", "vr-launcher.ts");
  const installedLauncher = path.join(installedRoot, "src", "scripts", "vr-launcher.ts");
  if (!existsSync(linkedLauncher) || !existsSync(installedLauncher)) return false;

  const linkedNewer = statSync(linkedLauncher).mtimeMs > statSync(installedLauncher).mtimeMs;
  if (!linkedNewer) return false;

  cpSync(path.join(linkedRoot, "src"), path.join(installedRoot, "src"), { recursive: true });
  for (const binFile of ["visual-regression.mjs", "spawn-tsx.mjs", "expo-env.mjs"]) {
    const from = path.join(linkedRoot, "bin", binFile);
    const to = path.join(installedRoot, "bin", binFile);
    if (existsSync(from)) {
      cpSync(from, to);
    }
  }
  console.log("🔄 visual-regression : source file: synchronisée vers node_modules");
  return true;
};

const linkedPackageRoot = resolveLinkedPackageRoot(hostRoot);
const installedCopyRoot = resolveInstalledCopyRoot(hostRoot);

if (linkedPackageRoot && installedCopyRoot && path.resolve(linkedPackageRoot) !== path.resolve(installedCopyRoot)) {
  syncLinkedSourcesToInstalledCopy(linkedPackageRoot, installedCopyRoot);
}

/** Exécution depuis la copie installée (deps npm) quand file: + node_modules, sinon racine courante. */
const effectivePackageRoot =
  installedCopyRoot && linkedPackageRoot && path.resolve(linkedPackageRoot) !== path.resolve(installedCopyRoot)
    ? installedCopyRoot
    : (linkedPackageRoot ?? installedPackageRoot);
const packageTsconfigPath = path.join(effectivePackageRoot, "tsconfig.cli.json");
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
        "   Voir la documentation : https://github.com/sashalarrieu/visual-regression#readme\n",
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

let scriptPath;
/** Arguments supplémentaires passés au script tsx (ex. benchmark 12). */
let scriptArgs = [];
switch (subcommand) {
  case "server": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-server.ts");
    break;
  }
  case "compare": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "compare-visual-regressions.ts");
    break;
  }
  case "benchmark": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-benchmark-concurrency.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "benchmark-shards": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-benchmark-shards.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "test-incremental": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-test-incremental.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "test-validation": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-test-validation.ts");
    scriptArgs = process.argv.slice(3);
    break;
  }
  case "capture-daemon": {
    // Daemon de capture (exécuté DANS le conteneur). cwd = projet hôte (/work).
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-capture-daemon.ts");
    break;
  }
  case "capture-oneshot": {
    // Capture one-shot (CI, DANS le conteneur). cwd = projet hôte (/work).
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-capture-oneshot.ts");
    break;
  }
  case "capture-up":
  case "capture-down":
  case "capture-status": {
    // Contrôle du sidecar Docker depuis l'hôte.
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-capture-control.ts");
    scriptArgs = [subcommand.replace("capture-", "")];
    break;
  }
  case "kill-ports": {
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-kill-ports.ts");
    break;
  }
  case "app": {
    // Interface web VR (Expo). Ne pas forcer CI=1 : Metro désactive le hot reload en mode CI.
    const expoArgs = ["expo", "start", "--web", "--port", String(EXPO_PORT)];
    if (process.env.VR_CLEAR_METRO === "1") {
      expoArgs.push("--clear");
    }
    const child = spawn(npxRunner, expoArgs, spawnOpts(effectivePackageRoot, getExpoSpawnEnv(env, hostRoot)));
    child.on("error", err => {
      console.error("❌ Impossible de lancer l'interface VR:", err.message);
      process.exit(1);
    });
    child.on("exit", code => process.exit(code ?? 0));
    break;
  }
  default: {
    // pas d'argument ou "start" → launcher complet
    scriptPath = path.join(effectivePackageRoot, "src", "scripts", "vr-launcher.ts");
    break;
  }
}

if (scriptPath) {
  const tsxCli = getTsxCliPath(hostRoot, effectivePackageRoot);
  const useNpxFallback = !tsxCli;
  const child = spawnTsxScript({
    hostRoot,
    packageRoot: effectivePackageRoot,
    tsconfigPath: packageTsconfigPath,
    scriptPath,
    scriptArgs,
    cwd: effectivePackageRoot,
    env,
  });
  child.on("error", err => {
    console.error("❌ Impossible de lancer visual-regression:", err.message);
    if (useNpxFallback) {
      console.error(
        "   Ajoutez tsx au projet hôte: yarn add -D tsx\n" +
          "   ou installez dans le package: cd visual-regression && yarn install",
      );
    }
    process.exit(1);
  });

  const forwardSignal = signal => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  if (isWin) {
    process.on("SIGBREAK", () => forwardSignal("SIGBREAK"));
  }

  child.on("exit", code => process.exit(code ?? 0));
}

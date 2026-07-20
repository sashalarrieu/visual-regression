/**
 * Config Metro pour l'app standalone VR (expo start --web).
 * .cjs pour éviter sur Windows l'erreur ESM "Received protocol 'c:'" au chargement du config.
 *
 * Sous pnpm, les deps transitives (ex. semver pour reanimated) vivent dans le dossier
 * `node_modules` du package isolé (.pnpm/<pkg>@ver/node_modules/), pas à la racine.
 * On ajoute donc ces dossiers à nodeModulesPaths après résolution des deps directes.
 */
const fs = require("fs");
const path = require("path");

const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const hostProjectRoot = process.env.VR_PROJECT_ROOT || projectRoot;

/** Remonte l'arborescence et collecte les node_modules (pnpm virtual store, monorepo). */
const collectNodeModulesPaths = startDir => {
  const seen = new Set();
  const result = [];
  let dir = startDir;

  for (let depth = 0; depth < 10; depth++) {
    const nodeModules = path.join(dir, "node_modules");
    if (!seen.has(nodeModules) && fs.existsSync(nodeModules)) {
      seen.add(nodeModules);
      result.push(nodeModules);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return result.length > 0 ? result : [path.join(projectRoot, "node_modules")];
};

/**
 * Packages singleton : une seule instance, version de l'hôte (évite react 19.2 / react-dom 19.1).
 * Les autres deps déclarées du package VR restent résolues localement d'abord (ex. lru-cache@5).
 */
const HOST_FIRST_PACKAGES = new Set(["react", "react-dom", "react-native", "react-native-web", "scheduler"]);

/**
 * Résout chaque dépendance du package.
 * - singletons React : node_modules hôte d'abord
 * - deps / peerDeps VR : node_modules du package d'abord (lru-cache hoisté, etc.)
 * - puis les chemins consommateur (pnpm / monorepo)
 */
const buildExtraNodeModules = searchPaths => {
  const pkg = require(path.join(projectRoot, "package.json"));
  const depNames = Object.keys({
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.devDependencies,
  });
  const extras = {};
  const packageLocalNm = path.join(projectRoot, "node_modules");
  const hostSearchPaths = searchPaths.filter(searchPath => searchPath !== packageLocalNm);

  for (const depName of depNames) {
    const orderedSearchPaths = HOST_FIRST_PACKAGES.has(depName)
      ? [...hostSearchPaths, packageLocalNm]
      : [packageLocalNm, ...hostSearchPaths];

    for (const searchPath of orderedSearchPaths) {
      const depPath = path.join(searchPath, depName);
      if (fs.existsSync(depPath)) {
        extras[depName] = fs.realpathSync(depPath);
        break;
      }
    }
  }

  return extras;
};

/**
 * Pour chaque package résolu, ajoute le `node_modules` parent (isolation pnpm)
 * afin que Metro trouve les deps transitives (semver, etc.).
 */
const collectPnpmIsolationNodeModules = extras => {
  const result = [];
  const seen = new Set();
  for (const depPath of Object.values(extras)) {
    // .../.pnpm/pkg@ver/node_modules/pkg → .../.pnpm/pkg@ver/node_modules
    const isolationNm = path.dirname(depPath);
    if (path.basename(isolationNm) !== "node_modules") continue;
    if (seen.has(isolationNm) || !fs.existsSync(isolationNm)) continue;
    seen.add(isolationNm);
    result.push(isolationNm);
  }
  return result;
};

const nodeModulesPaths = collectNodeModulesPaths(projectRoot);
nodeModulesPaths.sort((a, b) => {
  const aHasExpo = fs.existsSync(path.join(a, "expo"));
  const bHasExpo = fs.existsSync(path.join(b, "expo"));
  return Number(bHasExpo) - Number(aHasExpo);
});

const extraNodeModules = buildExtraNodeModules(nodeModulesPaths);
for (const isolationNm of collectPnpmIsolationNodeModules(extraNodeModules)) {
  if (!nodeModulesPaths.includes(isolationNm)) {
    nodeModulesPaths.push(isolationNm);
  }
}

const config = getDefaultConfig(projectRoot);
config.watchFolders = [hostProjectRoot, projectRoot];
config.resolver.nodeModulesPaths = nodeModulesPaths;
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = extraNodeModules;

// Screenshots VR : churn élevé pendant compare — évite ENOENT FallbackWatcher (Windows)
config.resolver.blockList.push(/[\\/]public[\\/]Screenshots[\\/].*/);

module.exports = config;

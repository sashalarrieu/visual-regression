/**
 * Config Metro pour l'app standalone VR (expo start --web).
 * .cjs pour éviter sur Windows l'erreur ESM "Received protocol 'c:'" au chargement du config.
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

/** Résout chaque dépendance du package depuis les node_modules pnpm du consommateur. */
const buildExtraNodeModules = searchPaths => {
  const pkg = require(path.join(projectRoot, "package.json"));
  const depNames = Object.keys({
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.devDependencies,
  });
  const extras = {};

  for (const depName of depNames) {
    for (const searchPath of searchPaths) {
      const depPath = path.join(searchPath, depName);
      if (fs.existsSync(depPath)) {
        extras[depName] = depPath;
        break;
      }
    }
  }

  return extras;
};

const nodeModulesPaths = collectNodeModulesPaths(projectRoot);
nodeModulesPaths.sort((a, b) => {
  const aHasExpo = fs.existsSync(path.join(a, "expo"));
  const bHasExpo = fs.existsSync(path.join(b, "expo"));
  return Number(bHasExpo) - Number(aHasExpo);
});

const config = getDefaultConfig(projectRoot);
config.watchFolders = [hostProjectRoot, projectRoot];
config.resolver.nodeModulesPaths = nodeModulesPaths;
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = buildExtraNodeModules(nodeModulesPaths);

// Screenshots VR : churn élevé pendant compare — évite ENOENT FallbackWatcher (Windows)
config.resolver.blockList.push(/[\\/]public[\\/]Screenshots[\\/].*/);

module.exports = config;

/**
 * Config Metro pour l'app standalone VR (expo start --web).
 * .cjs pour éviter sur Windows l'erreur ESM "Received protocol 'c:'" au chargement du config.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Screenshots VR : churn élevé pendant compare — évite ENOENT FallbackWatcher (Windows)
config.resolver.blockList.push(/[\\/]public[\\/]Screenshots[\\/].*/);

module.exports = config;

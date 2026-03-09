/**
 * Config Metro pour l'app standalone VR (expo start --web).
 * Metro est le bundler par défaut pour le web depuis Expo SDK 50+ (remplace Webpack).
 * Les alias (@atoms, @components, etc.) sont gérés par babel.config.cjs (module-resolver).
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;

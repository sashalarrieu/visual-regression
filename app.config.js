/**
 * Config Expo pour l'app standalone de régression visuelle.
 * Utilisée uniquement par `yarn vr` / `visual-regression app`.
 * Expo 54+ résout l'entrée via package.json "main" (src/index.tsx).
 * L'API npm reste sur src/index.ts via le champ "exports".
 */
module.exports = {
  expo: {
    name: "Visual Regression",
    slug: "visual-regression",
    platforms: ["ios", "android", "web"],
    web: {
      bundler: "metro",
    },
  },
};

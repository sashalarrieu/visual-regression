/**
 * Config Expo pour l'app standalone de régression visuelle.
 * Utilisée uniquement par `yarn vr` / `visual-regression app`.
 * Expo 54+ résout l'entrée via package.json "main" (src/index.tsx).
 * L'API npm reste sur src/index.ts via le champ "exports".
 *
 * Les icônes / favicons vivent dans `assets/` (servi comme dossier public Expo).
 * Storybook n'est pas concerné.
 */
module.exports = {
  expo: {
    name: "Visual Regression",
    slug: "visual-regression",
    platforms: ["ios", "android", "web"],
    icon: "./assets/web-app-manifest-512x512.png",
    web: {
      bundler: "metro",
      favicon: "./assets/favicon-96x96.png",
      themeColor: "#090100",
    },
  },
};

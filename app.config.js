/**
 * Config Expo pour l'app standalone de régression visuelle.
 * Utilisée uniquement par `yarn vr:app` / `visual-regression app`.
 * Le point d'entrée est explicité ici car package.json "main" pointe vers l'API du package (src/index.ts).
 */
module.exports = {
  expo: {
    name: "Visual Regression",
    slug: "visual-regression",
    entryPoint: "./src/index.tsx",
    platforms: ["ios", "android", "web"],
    web: {
      bundler: "metro",
    },
  },
};

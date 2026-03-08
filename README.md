# visual-regression

Projet indépendant de régression visuelle pour Storybook. Réutilisable dans tout projet (Expo, React Native Web, etc.).

## Utilisation dans un projet hôte (ex: EIWIE_PRO_FRONTEND)

1. **Installation** (workspace ou npm)
   ```json
   "dependencies": {
     "visual-regression": "file:../visual-regression"
   }
   ```

2. **Afficher l’UI de régression** quand la variable d’environnement est définie :
   ```tsx
   import { VisualRegressions } from "visual-regression";

   if (process.env.VISUAL_REGRESSIONS === "true") {
     return <VisualRegressions />;
   }
   ```

3. **Scripts** : les commandes de régression (serveur VR, launcher, comparaison Playwright/Loki) restent dans le projet hôte, car elles dépendent de la config Storybook et Loki du projet. Exemple dans le projet hôte :
   - `vr` : lance l’environnement complet (serveur VR + Storybook + Expo)
   - `vr:server` : lance uniquement le serveur VR
   - `vr:app` : lance l’app Expo en mode régression (port 2804)

Le projet hôte doit avoir à la racine :
- `.storybook/` (config Storybook)
- `loki.config.cjs` (configurations des devices)
- `public/` (dossier où seront écrits les screenshots)

## Variables d’environnement

- `VR_PROJECT_ROOT` : racine du projet hôte (défaut : `process.cwd()`).
- `VISUAL_REGRESSIONS` : `"true"` pour afficher l’écran de régression dans l’app.
- `VR_COMPARE_LOKI` : `"true"` pour utiliser Loki au lieu de Playwright pour la comparaison.

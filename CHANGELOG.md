# Changelog

Ce projet suit le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.2/) et respecte le versioning semantique.

## [Unreleased]

### Fixed

- Storybook du sidecar **reste à jour** en mode `dev` **et** `static` : keep-fresh poll **mtime+size** (~50 ms) au lieu d’un SHA1 de tout le repo (~7k fichiers / ~10 s, event loop bloquée → aucun nudge). En `dev`, `utimes` intra-conteneur débloque le HMR inotify ; en `static`, rebuild avec caches Vite/Storybook vidés. `index.json` n’est plus servi en `immutable`. Les sidecars sans `keepFresh` sont recréés.
- `launcher.storybookMode` de `vr.config.cjs` est respecté en local (`static` ou `dev`). Plus d’override HMR silencieux. En static, l’attente daemon passe à 30 min (build Vite 10–20 min). Keep-fresh rebuild si les sources changent ; empreinte figée **avant** le compile.

## [1.3.0] - 2026-08-17

### Added

- Arbre UI : Maj+clic pour sélectionner une plage de stories, Option+clic (Alt) pour ouvrir/fermer récursivement un accordéon, bouton tout déplier / tout replier.
- UI : panneau arbre redimensionnable (`DraggableSplitView`, double-clic pour reset).
- Favicons / PWA Expo web servis depuis `assets/` (`EXPO_PUBLIC_FOLDER`).
- Helper `vrStorybookAddons` pour retirer `@storybook/addon-vitest` dans le sidecar.

### Fixed

- Arbre UI : Option+clic (macOS, équivalent Alt) ouvre/ferme récursivement un accordéon — React Native Web ignorait `onPress` si `altKey`.
- Arbre UI : les stories d’un dossier s’affichent avant les sous-dossiers.
- Sidecar Docker : `launcher.storybookMode` / `VR_STORYBOOK_MODE` sont respectés (env → `vr.config.cjs` → défaut). L’entrypoint n’écrase plus le mode en HMR.
- `yarn vr` lance Storybook **dev (HMR)** par défaut, comme `yarn storybook` : plus de snapshot statique figé. Un sidecar déjà en mode static est recréé. En mode static (CI), le rebuild se base sur une empreinte du **contenu** des stories, pas le mtime Docker.
- Sidecar Docker : l’image Playwright suit la version **résolue dans le lockfile du projet hôte** pour `@setshao/visual-regression` (pas le Playwright Vitest hoisté). Rebuild auto si le tag `vr-capture:<version>` change.
- Storybook du sidecar : `@storybook/addon-vitest` est retiré (`VR_DOCKER=1`) — plus d’erreur `UniversalStoreFollowerTimeoutError` (`storybook/test`).
- Capture : Reanimated web est figé via `prefers-reduced-motion: reduce` (contexte Playwright + `emulateMedia` avant navigation). Le decorator Storybook ne réimporte plus Reanimated (Vite / FlatList). Opt-out inchangé : tag `live-animation-vr`.
- Capture : l'iframe pose `embed=true` pour couper l'autoplay Storybook. `play()` s'exécute alors dans le decorator (après les `useEffect` de sync props→state) — plus d'onglet / sélection réinitialisés au screenshot.

## [1.2.0] - 2026-08-07

### Added

- UI : trois onglets d’arbre (régressions, catalogue Storybook, orphelins conditionnels) avec search et filtres de statut.
- Endpoints `GET /regressions/stories-tree` et `GET /regressions/orphans-tree`.
- Multi-sélection dans l’arbre avec actions bulk (validate / delete / compare) et endpoints `POST /validate/selected`, `POST /delete/selected`.
- Modal d’erreurs de capture (`GET /regressions/capture-errors`) pour régénérer cas par cas ou en masse.
- Auth npm privé dans le sidecar Docker (`NPM_TOKEN` / `NODE_AUTH_TOKEN`, en complément du mount `~/.npmrc`).

### Fixed

- Capture VR : les modals / portals rendus hors de `#storybook-root` (backdrop visible, panneau hors crop) sont inclus via un clip élargi (union root ∪ overlays).
- Docs Storybook : focus patché, navigation validate/refuse et compteurs px.
- Decorator preview VR allégé (retrait SafeArea / GestureHandler).

## [1.1.5] - 2026-07-20

### Fixed

- Sidecar Docker et captures UI : priorisation des singletons React depuis l’hôte dans Metro, résumé VR après les batches UI, logs timeout sans doublon.
- Restauration des dépendances optionnelles dans le sidecar CI (bindings natifs Storybook / `oxc-parser` sous Linux).

## [1.1.4] - 2026-07-20

### Fixed

- Conflit `lru-cache` hoisté qui cassait Metro/Babel : résolution locale des deps du package VR et pin `lru-cache@5` / `yallist`.

## [1.1.3] - 2026-07-20

### Added

- Ports sidecar dynamiques, `concurrencyDev`, CLI `kill-ports` / `validate-delete`.
- Logs Docker optionnels (`docker.showLogs`), export `@setshao/visual-regression/types`, volumes `node_modules` masqués pour les deps `file:`.
- Ouverture Storybook/Expo sans doublon d’onglets et résumé compare enrichi (décompte + durée).

### Fixed

- Auto-démarrage de Storybook dans `vr:test-validation` quand l’URL résolue est absente.
- Synchronisation de `yarn.lock` après bump reanimated / worklets / semver (CI `frozen-lockfile`).

## [1.1.2] - 2026-07-15

### Changed

- Authentification via trusted publishing OIDC configuré.

## [1.1.0] - 2026-07-15

### Added

- Export Storybook comme sous-module npm (`@setshao/visual-regression/storybook`).
- Extension de `vr.config.cjs` : backend capture, mode Storybook, sharding CI, section Docker.
- Module `spawn-tsx.mjs` pour un lancement fiable des scripts tsx (pnpm, chemins Windows avec espaces).
- Documentation détaillée de la configuration VR dans le README.
- Exposition de `storyCount` via l'API serveur VR.

### Changed

- Renforcement de la compatibilité cross-platform et de la CI multi-OS.
- Auto-détection du mode Storybook (dev/static) selon l'environnement.
- Invalidation du cache Docker pour les dépendances `file:` locales.

### Fixed

- Stabilisation du lancement Expo pour les consommateurs npm/pnpm/yarn.
- Authentification `NPM_TOKEN` restaurée dans le workflow de publication npm (trusted publishing OIDC non configurée côté npm).

## [1.0.0] - 2026-07-09

### Added

- Premiere publication npm de `@setshao/visual-regression`.
- CLI `visual-regression` (server, compare, app, capture Docker, benchmark, validation).

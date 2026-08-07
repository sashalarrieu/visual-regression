# Changelog

Ce projet suit le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.2/) et respecte le versioning semantique.

## [Unreleased]

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

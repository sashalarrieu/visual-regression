# Changelog

Ce projet suit le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.1/) et respecte le versioning semantique.

## [1.1.1] - 2026-07-15

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

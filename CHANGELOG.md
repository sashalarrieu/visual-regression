# Changelog

Ce projet suit le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.2/) et respecte le versioning semantique.

## [Unreleased]

### Added

- Helpers play `findOverflowScroller` / `scrollElementToEnd` (nœud overflow RN Web souvent descendant du `testID`).
- Capture Docker : `--disable-features=OverlayScrollbar` et `ignoreDefaultArgs: ["--hide-scrollbars"]` (Playwright les masquait). `parameters.vr.showScrollbars` force les barres classiques après `play()`. Helpers `findOverflowScroller` / `scrollElementToEnd` (contenu stable).
- `parameters.vr.clipMode`: `"root"` force le crop `#storybook-root` (ignore les overlays hors root) ; `"auto"` (défaut) n’élargit le clip que pour une Modal / dialog **ouverte**.

### Fixed

- `src/web.css` (outline, scrollbars, layout `#root`) est chargé par l’UI VR (Expo web) et le Storybook de démo de la lib.
- Mode static Docker : le build VR n’écrit plus `storybook-static/iframe.html` dans le projet hôte (`/tmp/vr-storybook-static`). `yarn storybook` peut tourner en parallèle sans full-reload Vite ni OOM. `preview-stats.json` est recopié pour le compare. CI conserve `storybook-static/` (cache).
- Capture : plus de `blur()` après `play()`. Le CSS (`outline: none` + `caret-color: transparent`) suffit à masquer l’anneau Chromium ; le blur fermait les listes d’autocomplete encore ouvertes (AddressField, CompanySearchField).
- Capture : overlay Storybook `sb-show-preparing-story` / `nopreview` / root vide **ou sans contenu visible** → **erreur de capture** (plus de PNG blanc classé en fail). Les Modals RNW fermées (opacity 0, `aria-hidden`, coquille full-viewport sans contenu) ne forcent plus `opacity:1` et n’élargissent plus le clip. L’hôte RNW d’une Modal **ouverte** (bbox 0 car dialog `position:fixed`) n’est plus masqué — sinon le PNG n’a que le trigger, classé en fail. Un calque plein viewport **sans** dialog ouvert (page blanche hors story) est masqué et n’élargit plus le clip. Les bandes 100% blanches en bas du PNG (page hors story) sont rognées après capture — sans muter le layout (sinon RNW reset le scroll).
- Capture : après `play()`, l’anneau `:focus` Chromium (bordure noire sur input / dialog) est neutralisé (`outline: none` + `caret-color: transparent`). `outline: unset` côté hôte rétablit l’anneau UA — la lib le force à `none` en capture.
- Capture : `#storybook-root` n’a plus besoin d’être `visible` si une Modal / dialog portailée est déjà ouverte (`play()` masque souvent le root). Le compteur « Capture errors » du résumé CLI = les erreurs uniques story×device (plus de double log timeout + Playwright, plus d’attribution du dernier log concurrent). `play()` VR : plus d’attente 2,5 s ni de remount sur l’identité de `playFunction`. Overlay Storybook `sb-show-errordisplay` → échec immédiat avec le message preview (plus de timeout 10 s sur un root vide). Helper Vite `applyVrStorybookBrowserShims` : stub `expo-updates` + runtime winter Expo (`require is not defined` dans l’iframe). Timeout capture : screenshot de salvage si `data-vr-ready=true` (ou story sans play déjà peinte) — évite d’échouer alors que le `play()` a déjà consommé le budget.
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

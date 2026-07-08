# @setshao/visual-regression

[![CI](https://github.com/setshao/visual-regression/actions/workflows/ci.yml/badge.svg)](https://github.com/setshao/visual-regression/actions/workflows/ci.yml)
[![VR Integration](https://github.com/setshao/visual-regression/actions/workflows/integration.yml/badge.svg)](https://github.com/setshao/visual-regression/actions/workflows/integration.yml)

Solution de régression visuelle **clé en main** pour tout projet qui possède un **Storybook**, quelle que soit la techno.  
Le package fournit une **app web de régression dédiée** (UI intégrée dans le package) pour parcourir les stories, visualiser les screenshots (NEW / DIFF), voir les heatmaps, naviguer entre devices et gérer l’historique des validations / refus.

---

## Objectif

- **But principal**  
  Fournir une solution complète de régression visuelle autour de Storybook, en prenant en charge **à la fois** l’interface web de validation et **toute la mécanique de capture/comparaison** (Playwright, serveur VR, orchestration).

- **Ce que le package apporte**
  - **Interface web intégrée** : l’UI VisualRegressions est interne au package et exposée via l’app web servie par `visual-regression` (l’hôte n’a pas à importer de composants UI dans son app).
  - **Logique complète de VR** : récupération des régressions, affichage des différences (NEW / DIFF), heatmap, historique des refusés, navigation entre stories et devices.
  - **Scripts d’orchestration** : serveur VR, captures/comparaisons Playwright, launcher qui gèrent Storybook et la génération/lecture des screenshots sans que le projet hôte doive maintenir sa propre “infra VR”.
  - **Gestion du dossier de screenshots** : le répertoire de screenshots (par défaut `public/`) est géré par `visual-regression` ; s’il n’existe pas, le package s’occupe de le créer et de l’utiliser pour stocker/servir les images.

- **Rôle du projet hôte**
  - Posséder un **Storybook** (les stories sont la source de vérité pour les captures).
  - Fournir une **configuration VR** (`vr.config.cjs` au format attendu).
  - Lancer les scripts `visual-regression` depuis la **racine** du projet (ou via `VR_PROJECT_ROOT`).

En résumé, `visual-regression` vise à **industrialiser la régression visuelle autour de Storybook**, avec un rôle minimal pour le projet hôte : configurer ses devices et lancer les scripts.

---

## Fonctionnement

- **Ce package** : app web de régression (UI intégrée), logique cliente (navigation dans les stories/devices, visualisation NEW / DIFF avec heatmap, validation/refus, historique), **et les scripts** (serveur VR, launcher, comparaison Playwright). Tout tourne en autonomie : le package ne laisse rien à maintenir dans le projet hôte côté scripts ou UI.
- **Le projet hôte** : à la racine, un fichier `vr.config.cjs` et un dossier `.storybook/` pour Storybook. Le répertoire de screenshots (par défaut `public/`) est automatiquement créé/utilisé par le package si nécessaire. On lance les commandes VR depuis la **racine du projet hôte** (ou avec `VR_PROJECT_ROOT` pointant vers cette racine) ; les scripts du package utilisent alors cette racine pour charger la config et servir les fichiers.

**Prérequis côté projet hôte** : `vr.config.cjs`, `.storybook/`. Les **devices** se configurent en format **Playwright** (voir section suivante). Le dossier `public/` est géré automatiquement par `visual-regression` (créé si absent).

---

## Configuration (`vr.config.cjs`)

L’utilisation de `@setshao/visual-regression` impose de **définir un fichier `vr.config.cjs`** à la racine du projet hôte. Il regroupe les devices et les paramètres du moteur VR. Chaque device doit inclure les champs viewport (pour les scripts de capture) **et** la personnalisation d’affichage (label, icon, color) pour l’UI :

```js
// vr.config.cjs
module.exports = {
  devices: [
    {
      name: "desktop-fhd",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      isMobile: false,
      label: "Desktop FHD",
      icon: "laptop",
      color: "newTheme_primary",
    },
    {
      name: "iphone16",
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      label: "iPhone 16",
      icon: "phone-iphone",
      color: "newTheme_fantasy",
    },
  ],
  // Sections optionnelles (défauts du package si absentes) :
  capture: { concurrency: 8, maxTestTime: 10_000 },
  compare: { mode: "incremental", base: "origin/main", threshold: 0 },
  launcher: { runInitialCompare: true, storybookStatic: false },
  storybook: { url: "http://localhost:6006" },
};
```

- **label** : texte affiché dans l’UI.
- **icon** : nom MaterialIcons (`@expo/vector-icons`), ex. `"laptop"`, `"phone-iphone"`, `"tablet-mac"`, `"tablet"`.
- **color** : clé de couleur du thème (ex. `"newTheme_primary"`, `"newTheme_danger"`).

Les scripts (serveur VR, comparaison Playwright) utilisent `name`, `viewport`, `deviceScaleFactor`, `isMobile`. L’UI utilise `name`, `label`, `icon`, `color` via la prop **obligatoire** `devices`, construite avec `fromVRDeviceConfig(config)`.

### Migration depuis `vr-devices.config.cjs`

Si vous aviez l’ancien format (tableau exporté directement), renommez le fichier en `vr.config.cjs` et enveloppez les devices :

```js
// Avant : module.exports = [ { name: "desktop-fhd", ... } ];
// Après :
module.exports = { devices: [ { name: "desktop-fhd", ... } ] };
```

Pas de rétrocompatibilité silencieuse : le package affiche un message explicite si `vr-devices.config.cjs` est encore présent sans `vr.config.cjs`.

### Hiérarchie de résolution

`valeur finale = variable d'environnement (VR_*) > vr.config.cjs > défauts du package`

Sections principales de `vr.config.cjs` :

| Section                               | Rôle                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `devices`                             | Viewports Playwright + affichage UI (obligatoire)                      |
| `capture.concurrency`                 | Pool parallèle Playwright (défaut ~15 sur demo)                        |
| `capture.maxTestTime`                 | Timeout attente story stable                                           |
| `compare.mode`                        | `"incremental"` (défaut) ou `"full"`                                   |
| `compare.scope`                       | `"all"` (CI) ou `"working-tree"` (test local sur branche feature)      |
| `compare.base`                        | Ref git pour le diff (ex. `origin/main`)                               |
| `compare.globalTriggers`              | Fichiers modifiés → run complet                                        |
| `compare.statsFile`                   | `preview-stats.json` pour TurboSnap                                    |
| `compare.diffVerificationMaxAttempts` | Recaptures max si diff (défaut `3`, env `VR_DIFF_VERIFY_MAX_ATTEMPTS`) |
| `launcher.runInitialCompare`          | Compare au `yarn vr` (défaut `true`)                                   |
| `storybook.url`                       | URL Storybook (override `VR_STORYBOOK_URL`)                            |
| `stabilize.*`                         | SteadySnap — voir section dédiée ci-dessous                            |

### SteadySnap (anti-flake)

Stabilisation des captures inspirée de [Chromatic SteadySnap](https://www.chromatic.com/blog/steadysnap/) — équivalent self-hosted, burst **opt-in** par défaut.

| Clé                            | Défaut  | Rôle                                           |
| ------------------------------ | ------- | ---------------------------------------------- |
| `stabilize.freezeAnimations`   | `true`  | Freeze CSS animations/transitions              |
| `stabilize.waitFonts`          | `true`  | Attend `document.fonts.ready`                  |
| `stabilize.waitNetworkQuietMs` | `0`     | Fenêtre sans requête réseau (ms) avant capture |
| `stabilize.maxStabilizeTime`   | `5000`  | Plafond attente stabilisation                  |
| `stabilize.burstCapture`       | `false` | Burst N frames pour toutes les stories         |
| `stabilize.burstFrames`        | `3`     | Nombre de frames burst                         |
| `stabilize.burstIntervalMs`    | `100`   | Intervalle entre frames burst                  |

**Tags Storybook :**

- `live-animation-vr` — **opt-out** : conserve Reanimated en capture (défaut = figé via preview)
- `burst-vr` — burst SteadySnap côté Playwright (stories animées non figées)
- `skip-play-vr` — n'exécute pas `play()` en capture (opt-out du decorator preview)
- `ignore-vr` / `force-vr` — exclusion / inclusion forcée au compare

**Storybook preview :** en capture (`vr-capture=1`), le decorator applique `ReducedMotionConfig` (Reanimated figé à l'état initial). Un second decorator exécute `play()` puis pose `data-vr-ready="true"` sur `#storybook-root`.

**Stories `play()` :** exécutées automatiquement avant chaque screenshot VR. Playwright attend `data-vr-ready="true"` sur les stories taguées `play-fn`.

**Vérification diff :** si une capture diffère de la baseline, le moteur relance jusqu'à match ou `compare.diffVerificationMaxAttempts` (défaut 3). Override global : `VR_DIFF_VERIFY_MAX_ATTEMPTS`.

**Overrides par story (`parameters.vr`)** — fusionnés sur `vr.config.cjs` (meta ou story CSF) :

| Clé                                         | Rôle                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `parameters.vr.stabilize.*`                 | Sous-ensemble de `stabilize` (ex. `burstIntervalMs`, `maxStabilizeTime`) |
| `parameters.vr.diffVerificationMaxAttempts` | Recaptures max pour cette story uniquement                               |

Définir `burstIntervalMs` ou `burstFrames` active automatiquement le burst pour la story (sans tag `burst-vr`).

```tsx
export const SlowIncrementToThree: Story = {
  parameters: {
    vr: {
      stabilize: { burstIntervalMs: 1000 },
      diffVerificationMaxAttempts: 5,
    },
  },
  play: async ({ canvasElement, step }) => {
    /* … */
  },
};
```

**Attente custom :** ajouter `data-vr-ready="true"` sur `#storybook-root` quand la story est prête (stories lourdes).

```js
compare: {
  diffVerificationMaxAttempts: 3,
},
stabilize: {
  freezeAnimations: true,
  waitNetworkQuietMs: 300,
  burstCapture: false,
},
```

### Mode incrémental et TurboSnap

Par défaut, seules les stories impactées par les fichiers modifiés sont recapturées :

1. Détection git (`compare.base` + working tree) ou manifest `.vr-cache/manifest.json`
2. Graphe Webpack via `storybook-static/preview-stats.json` (généré par `yarn storybook:build:stats`)
3. Fallback analyse imports statiques si stats absentes

Global triggers (`.storybook/**`, `package.json`, `yarn.lock`, `vr.config.cjs`) forcent un run complet.

L'UI expose les actions **régénération volontaire** en mode full via le serveur VR :

- `POST /compare/selected` → `compareSelectedStories`
- `POST /compare/by-type` → `compareByType` (new / diff / rejected)
- `POST /compare/all-stories` → `compareAllStories`

`POST /compare` lance la comparaison selon `compare.mode` (incrémental par défaut).

### API serveur VR (config)

| Route                             | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `GET /regressions/config`         | Config publique résolue (`compareMode`, `storybookUrl`, `captureConcurrency`, …) |
| `GET /regressions/config/devices` | Devices pour l'UI                                                                |

---

## Installation

**Via npm :**

```bash
npm install @setshao/visual-regression
# ou
yarn add @setshao/visual-regression
```

**En local (développement, lien vers le dossier du package) :**

```json
{
  "dependencies": {
    "@setshao/visual-regression": "file:../visual-regression"
  }
}
```

### Prérequis : navigateurs Playwright (Windows / nouvelle machine)

La comparaison visuelle utilise **Playwright** pour lancer Chromium. Les binaires ne sont **pas** inclus dans le package : ils doivent être installés **sur chaque machine** (et par OS).

**Sur Windows**, ou après un premier clone sur une nouvelle machine, exécute **une fois** à la racine du projet hôte :

```bash
cd <projet-hôte>   # ex. vow-frontend
npx playwright install chromium
```

Sans cela, la comparaison peut échouer avec un `TimeoutError: launch: Timeout 180000ms exceeded`. En cas de timeout persistant, le script utilise désormais un timeout plus long et des options adaptées à Windows.

> Remarque : avec la **capture Docker** (ci-dessous, comportement par défaut), vous n'avez **pas** besoin d'installer Chromium localement — l'image embarque déjà les navigateurs.

---

## Capture Docker (obligatoire, reproductible)

Pour garantir des screenshots **identiques quelle que soit la machine** (Windows Intel, Mac M4, CI Linux…), **toute capture s'exécute dans un conteneur Docker**. Les différences de rendu entre OS (moteur de police DirectWrite vs CoreText, GPU, gestion des couleurs) disparaissent car l'environnement de capture est figé.

### Principe

- Un **sidecar Docker** (`vr-capture`) héberge **Storybook** (dev HMR) + un **daemon de capture** (Playwright Chromium Linux).
- L'hôte (serveur VR, UI Expo, comparaison pixelmatch, index) **ne lance jamais Playwright** : chaque `runCaptureBatch` est délégué au daemon via HTTP (`POST /capture/batch`).
- Résultat : **100 % des screenshots** (compare globale, régénération depuis le TreePanel, CI) passent par Docker.

```
Hôte (vr-server + UI Expo)  ──POST /capture/batch──▶  Conteneur (Storybook + daemon + Playwright)
        ▲                                                        │
        └──────────── screenshots via volume monté ◀────────────┘
```

### Prérequis hôte

- **Docker** installé et démarré (Docker Desktop sur Mac/Windows).
- Un script `storybook:build:stats` dans le `package.json` (utilisé en mode statique/CI).

### Workflow dev

```bash
yarn vr
```

`yarn vr` démarre automatiquement le sidecar (build de l'image au premier lancement), attend que le daemon soit prêt, puis lance le serveur VR, la comparaison initiale et l'UI. Storybook tourne **dans le conteneur** (HMR : vos modifications de stories/composants sont prises en compte sans rebuild) et est forwardé sur `http://localhost:6006`.

Commandes de contrôle du sidecar :

| Script                   | Rôle                                  |
| ------------------------ | ------------------------------------- |
| `yarn vr:capture:up`     | Démarre le sidecar + attend le daemon |
| `yarn vr:capture:down`   | Arrête le sidecar                     |
| `yarn vr:capture:status` | État compose + health du daemon       |

### Workflow CI

En CI, on utilise le mode **Storybook statique** (build unique, plus déterministe) en one-shot :

```bash
docker compose \
  -f node_modules/@setshao/visual-regression/docker/docker-compose.ci.yml \
  up --build --abort-on-container-exit --exit-code-from vr-capture
```

Un exemple complet GitHub Actions (cache `node_modules` + `storybook-static`, sharding, upload d'artefacts) est fourni pour les **projets hôte** : [`docker/ci/github-actions.example.yml`](docker/ci/github-actions.example.yml).

> Ce dépôt lib dispose de ses propres workflows CI dans [`.github/workflows/`](.github/workflows/) (`ci.yml` sur chaque PR, `integration.yml` sur les PR touchant les fichiers critiques). L'exemple ci-dessus est à copier dans le dépôt consommateur, pas dans ce package.

> **Source de vérité** : les baselines validées en Docker/CI font foi. Ne régénérez jamais une baseline depuis une capture native OS.

### Variables d'environnement Docker

| Variable                  | Défaut                              | Rôle                                                                                                   |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `VR_CAPTURE_BACKEND`      | `docker`                            | `docker` = capture déléguée au daemon ; `local` = capture directe (tests internes / dans le conteneur) |
| `VR_CAPTURE_DAEMON_URL`   | `http://localhost:2810`             | URL du daemon de capture                                                                               |
| `VR_STORYBOOK_MODE`       | `dev`                               | `dev` (HMR) ou `static` (build + serve, CI)                                                            |
| `VR_DOCKER_IMAGE`         | `ghcr.io/setshao/vr-capture:1.61.1` | Image du sidecar (tag aligné sur la version Playwright)                                                |
| `VR_DOCKER`               | `1` (dans le conteneur)             | Active les flags Chromium déterministes                                                                |
| `VR_CAPTURE_REMOTE_CHUNK` | `20`                                | Taille des lots envoyés au daemon (évite les timeouts fetch)                                           |

### Utiliser son propre Docker (image maison)

L'image `ghcr.io/setshao/vr-capture` est un raccourci, pas une obligation. Vous pouvez fournir votre propre image (`VR_DOCKER_IMAGE`) tant qu'elle respecte le **contrat** :

- Base Linux avec **la même version de Playwright/Chromium** que le package (voir `docker/Dockerfile`).
- Code du projet hôte monté sur `/work` (`VR_PROJECT_ROOT=/work`).
- **node_modules Linux** dans un volume dédié (pas les binaires natifs Mac/Windows).
- `VR_DOCKER=1` et `VR_CAPTURE_BACKEND=local` dans le conteneur.
- Lancer le daemon (`visual-regression capture-daemon`) ou la capture one-shot (`visual-regression capture-oneshot`).

Toute divergence d'environnement (autre OS, autre Chromium, autre Node) peut réintroduire des différences de pixels entre machines.

---

## Utilisation dans un projet hôte

Dans l’utilisation standard, tu **n’as rien à importer dans ton app** : tu lances les scripts depuis la racine du projet hôte et tu ouvres l’URL de l’app web de régression dans ton navigateur.  
L’UI VisualRegressions est entièrement embarquée dans le package.

### 1. Scripts fournis par le package (à appeler depuis le projet hôte)

Le package contient les scripts dans `scripts/`. Depuis le **projet hôte**, ajoute dans ton `package.json` des scripts qui pointent vers le package (en lançant depuis la racine du projet pour que `process.cwd()` soit la racine) :

| Script                | Rôle                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `vr`                  | Lance tout : serveur VR + Storybook + Expo + comparaison incrémentale initiale (désactivable) |
| `vr:server`           | Lance uniquement le serveur VR (port 2805)                                                    |
| `vr:compare`          | Lance la comparaison Playwright (régénération des screenshots)                                |
| `vr:benchmark`        | Mesure la concurrency optimale sur 1 machine (`1..16`)                                        |
| `vr:benchmark-shards` | Simule le sharding CI (shardTotal × concurrency) sans lancer toute la matrix                  |
| `vr:test-validation`  | Checklist Phases 0–8 (`--static-only` sans Storybook)                                         |
| `vr:storybook:static` | Build Storybook + stats (`preview-stats.json`) puis serve sur le port 6006                    |
| `vr:app`              | Lance l’app Expo en mode régression (port 2804)                                               |
| `vr:capture:up`       | Démarre le sidecar Docker de capture (+ attend le daemon)                                     |
| `vr:capture:down`     | Arrête le sidecar Docker de capture                                                           |
| `vr:capture:status`   | État du sidecar + health du daemon (port 2810)                                                |
| `vr:kill-ports`       | Libère les ports 2804, 2805 et 2810                                                           |

Exemple dans le `package.json` du projet hôte (à lancer depuis la racine du projet) :

```json
{
  "scripts": {
    "vr": "bun node_modules/@setshao/visual-regression/scripts/vr-launcher.ts",
    "vr:server": "bun node_modules/@setshao/visual-regression/scripts/vr-server.ts",
    "vr:compare": "bun node_modules/@setshao/visual-regression/scripts/compare-visual-regressions.ts",
    "vr:app": "node node_modules/@setshao/visual-regression/bin/visual-regression.mjs app"
  }
}
```

### 2. Variables d’environnement

| Variable                            | Description                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `VR_PROJECT_ROOT`                   | Racine du projet hôte (défaut : `process.cwd()`)                                                     |
| `VR_CONCURRENCY`                    | Override de `capture.concurrency`                                                                    |
| `VR_MAX_TEST_TIME`                  | Override de `capture.maxTestTime` (ms)                                                               |
| `VR_COMPARE_MODE`                   | `"incremental"` ou `"full"`                                                                          |
| `VR_COMPARE_SCOPE`                  | `"all"`, `"branch"` ou `"working-tree"` (périmètre git incrémental)                                  |
| `VR_COMPARE_BASE`                   | Ref git pour le diff (ex. `origin/main`)                                                             |
| `VR_THRESHOLD`                      | Seuil pixelmatch                                                                                     |
| `VR_RUN_INITIAL_COMPARE`            | `true` / `1` force la comparaison au `yarn vr` ; `false` / `0` la désactive (défaut config : `true`) |
| `VR_STORYBOOK_STATIC`               | `true` / `1` pour Storybook build + serve au `yarn vr` (au lieu de `storybook dev`)                  |
| `VR_STORYBOOK_STATIC_REBUILD`       | `1` force le rebuild de `storybook-static/` au lancement statique                                    |
| `VR_STORYBOOK_URL`                  | URL Storybook (défaut : `http://localhost:6006`)                                                     |
| `VR_SHARD_INDEX` / `VR_SHARD_TOTAL` | Sharding CI (env uniquement, index 0-based). Ex. `VR_SHARD_INDEX=0 VR_SHARD_TOTAL=4 yarn vr:compare` |
| `VR_CAPTURE_BACKEND`                | `docker` (défaut) délègue la capture au daemon ; `local` capture directe (tests / conteneur)         |
| `VR_CAPTURE_DAEMON_URL`             | URL du daemon de capture (défaut : `http://localhost:2810`)                                          |
| `VR_STORYBOOK_MODE`                 | `dev` (HMR) ou `static` (build + serve, CI) dans le conteneur                                        |
| `VR_DOCKER_IMAGE`                   | Image du sidecar (défaut : `ghcr.io/setshao/vr-capture:1.61.1`)                                      |
| `VR_CAPTURE_REMOTE_CHUNK`           | Taille des lots envoyés au daemon (défaut : `20`)                                                    |

### Benchmark performance (concurrency + sharding CI)

Workflow recommandé pour dimensionner la CI :

```bash
# 1. Trouver la concurrency optimale sur 1 machine (Storybook requis)
yarn vr:benchmark

# 2. Simuler le sharding CI (rapide, pas de matrix réelle)
yarn vr:benchmark-shards --ms-per-task 1800 --concurrency 12,15,16

# Ou calibrer ms/tâche automatiquement (20 captures)
yarn vr:benchmark-shards --calibrate --full
```

Options utiles de `vr:benchmark-shards` :

| Option                            | Description                                         |
| --------------------------------- | --------------------------------------------------- |
| `[maxShards]` ou `--max-shards N` | Tester shardTotal de 1 à N (défaut 8)               |
| `--setup-ms N`                    | Coût fixe par job CI en ms (défaut 180000 = 3 min)  |
| `--ms-per-task N`                 | Durée moyenne par capture (issue de `vr:benchmark`) |
| `--concurrency 12,15,16`          | Liste de concurrencies à tester                     |
| `--full`                          | Toutes les tâches (défaut)                          |
| `--incremental`                   | Périmètre TurboSnap actuel                          |
| `--calibrate`                     | Mesure ms/tâche via un échantillon de 20 captures   |

Validez ensuite la config recommandée en vraie CI matrix avec `VR_SHARD_INDEX` / `VR_SHARD_TOTAL`.

### Validation Phases 0–8

```bash
yarn vr:test-validation              # checklist complète (Storybook requis pour partie dynamique)
yarn vr:test-validation --static-only  # config, exports, TurboSnap fichier, sharding — sans Storybook
```

Couvre : `vr.config.cjs`, overrides env, TurboSnap, sharding, exports compare UI, incrémental sans changement.

---

## Développement (contributeurs)

### Prérequis

- Node.js 20+
- Yarn 1.x
- Docker (pour l'intégration VR locale ou CI)

### Commandes utiles

| Commande                                | Rôle                                           |
| --------------------------------------- | ---------------------------------------------- |
| `yarn typecheck`                        | Vérification TypeScript (`tsc --noEmit`)       |
| `yarn test`                             | Tests unitaires Vitest (mode watch)            |
| `yarn test:ci`                          | Tests unitaires en CI (run unique)             |
| `yarn lint` / `yarn lint:fix`           | ESLint                                         |
| `yarn format:check` / `yarn format`     | Prettier                                       |
| `yarn vr:test-validation --static-only` | Checklist statique Phases 0–9 (sans Storybook) |

Un hook pre-commit Husky exécute `lint-staged` (Prettier + ESLint sur les fichiers stagés).

### CI GitHub (ce dépôt)

| Workflow                                                     | Déclencheur                                 | Rôle                                                            |
| ------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)                         | Chaque PR + push `main`                     | Typecheck, lint, format, tests unitaires, validation statique   |
| [`integration.yml`](.github/workflows/integration.yml)       | PR modifiant scripts/utils/docker/demo/etc. | Capture VR Docker complète sur la demo (`VR_COMPARE_MODE=full`) |
| [`docker-publish.yml`](.github/workflows/docker-publish.yml) | Tag `v*`                                    | Publication image `ghcr.io/setshao/vr-capture`                  |

---

## Tester que tout fonctionne

### Test rapide (uniquement l’interface)

1. Dans le projet hôte : `yarn` (ou `npm install`) pour installer le lien vers `visual-regression` si tu es en local.
2. **Terminal 1** : `yarn vr:server` → serveur sur http://localhost:2805
3. **Terminal 2** : `yarn vr:app` → app sur http://localhost:2804
4. Ouvre http://localhost:2804 : tu dois voir l’interface (panneau « Régressions visuelles », zone de contenu). Au début, le message « Aucune regression détectée, ni nouvelle screenshot » est normal.

### Test complet (avec Storybook et comparaison)

Dans le projet hôte :

```bash
yarn vr
```

Puis ouvre http://localhost:2804 : après la comparaison, l’arbre des régressions et les screenshots doivent apparaître.

---

## Publier une nouvelle version sur npm

1. Se connecter : `npm login` (username, password, email, OTP si 2FA).
2. Vérifier le contenu publié : `npm pack --dry-run`.
3. Première publication (package scopé public) : `npm publish --access public`.
4. Versions suivantes : incrémenter `version` dans `package.json`, puis `npm publish`.

Pour utiliser la version npm dans un projet : `yarn add @setshao/visual-regression` et garder l’import `import { VisualRegressions } from "@setshao/visual-regression";`.

---

## Dépannage

- **« Cannot find module '@setshao/visual-regression' »**  
  Vérifier que `yarn` / `npm install` a bien été exécuté et que `node_modules/@setshao/visual-regression` existe (ou le lien `file:../visual-regression`).

- **Interface blanche ou crash**  
  Ouvrir la console du navigateur (F12). Si le serveur VR n’est pas démarré, l’app peut afficher « Aucune regression détectée » ; lancer le serveur VR dans un autre terminal.

- **Port déjà utilisé**  
  Utiliser la commande du projet hôte pour libérer les ports (ex. `yarn vr:kill-ports`), puis relancer.

- **« Module not found » pour les scripts VR**  
  Si `node_modules/@setshao/visual-regression/scripts/` n’existe pas, réinstalle la dépendance (ex. supprimer `node_modules/@setshao/visual-regression` puis `yarn install`, ou `yarn add file:../visual-regression` depuis la racine du monorepo) pour que le dossier `scripts` soit bien présent.

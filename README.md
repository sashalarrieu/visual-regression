# @setshao/visual-regression

[CI](https://github.com/sashalarrieu/visual-regression/actions/workflows/ci.yml)
[Platform](https://github.com/sashalarrieu/visual-regression/actions/workflows/platform.yml)
[VR Integration](https://github.com/sashalarrieu/visual-regression/actions/workflows/integration.yml)

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

### À quoi sert ce fichier ?

`vr.config.cjs` est le **fichier de configuration unique** de la régression visuelle. Il se place à la **racine de votre projet** (à côté de `package.json`).

Il indique notamment :

- sur **quels écrans** capturer (desktop, mobile, tablette…) ;
- **comment** comparer les screenshots (incrémental, seuil de diff, etc.) ;
- **comment** lancer Storybook et Docker au démarrage.

> **Règle simple** : vous n’avez besoin de modifier que ce qui vous concerne. Tout ce que vous omettez prend une **valeur par défaut** sensée.

### Priorité des réglages

Quand la même option existe à plusieurs endroits, l’ordre est :

**variable d’environnement** `VR_`* **→** `vr.config.cjs` **→ défaut du package**

Le sidecar Docker **respecte le même ordre** : le launcher résout le mode puis exporte `VR_STORYBOOK_MODE` dans Compose. L’entrypoint ne force plus le HMR.

Exemple : si `vr.config.cjs` met `capture.concurrency: 8` mais que la CI exporte `VR_CONCURRENCY=4`, c’est **4** qui sera utilisé.

> **Concurrency ≠ un seul chiffre partout**
>
> - `capture.concurrency` → Storybook **static** (local) **et CI**
> - `capture.concurrencyDev` → Storybook **dev** (Vite/HMR), souvent plus bas  
>   Sinon, avec `yarn vr` en mode dev, un `concurrency: 15` ne donne **pas** 15 workers.

---

### Exemple minimal (pour démarrer)

Seule la section `devices` est **obligatoire** :

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
  ],
};
```

---

### Exemple complet (toutes les sections)

```js
// vr.config.cjs — commentaires = aide, pas besoin de tout copier
module.exports = {
  // ── OBLIGATOIRE ─────────────────────────────────────────────
  devices: [/* voir tableau « devices » ci-dessous */],

  // ── CAPTURE (Playwright + Docker) ───────────────────────────
  capture: {
    // static (local) + CI — override CI : VR_CONCURRENCY
    concurrency: 8,
    // Storybook dev (Vite) — override : VR_CONCURRENCY_DEV
    concurrencyDev: 2,
    maxTestTime: 10_000, // timeout par story (ms)
    remoteChunkSize: 50, // nb de screenshots par requête HTTP vers Docker
    backend: "docker", // "docker" (défaut) ou "local"
    daemonUrl: "http://localhost:2810", // omis = port hôte dérivé du projet (recommandé)
  },

  // ── COMPARAISON (git, incrémental, diffs) ───────────────────
  compare: {
    mode: "incremental", // "incremental" ou "full"
    base: "origin/main", // branche git de référence
    scope: "all", // quels fichiers git regarder
    includeWorkingTree: true, // inclure vos modifs non commitées
    threshold: 0, // sensibilité pixelmatch (0 = strict)
    diffVerificationMaxAttempts: 3,
    globalTriggers: [".storybook/**", "package.json", "vr.config.cjs"],
    statsFile: "storybook-static/preview-stats.json",
    manifestPath: ".vr-cache/manifest.json",
    // shardIndex: 0,         // optionnel — sharding CI (0-based)
    // shardTotal: 4,
  },

  // ── LANCEMENT (`yarn vr`) ───────────────────────────────────
  launcher: {
    runInitialCompare: true, // comparer au démarrage de `yarn vr`
    // storybookMode: "dev",  // "dev" | "static" | omis = auto
    forceStaticRebuild: false,
  },

  // ── STORYBOOK ───────────────────────────────────────────────
  // storybook.url omis = port hôte dérivé du projet (recommandé avec Docker)
  // storybook: { url: "http://localhost:6100" }, // override manuel si besoin

  // ── STABILISATION DES CAPTURES (anti-flake) ─────────────────
  stabilize: {
    freezeAnimations: true,
    waitFonts: true,
    waitNetworkQuietMs: 0,
    maxStabilizeTime: 5_000,
    burstCapture: false,
    burstFrames: 3,
    burstIntervalMs: 100,
  },

  // ── DOCKER (avancé) ─────────────────────────────────────────
  docker: {
    image: "vr-capture:1.61.1",
    playwrightImage: "mcr.microsoft.com/playwright:v1.61.1-jammy",
    showLogs: false, // true = streamer `docker compose logs -f` dans le terminal
  },
};
```

---

### Référence détaillée

#### `devices` _(obligatoire)_

Liste des **formats d’écran** sur lesquels chaque story sera capturée.  
Une story = **1 screenshot par device** (ex. 28 stories × 2 devices = 56 images).

| Paramètre                            | Description                                              | Exemple              |
| ------------------------------------ | -------------------------------------------------------- | -------------------- |
| `name`                               | Identifiant unique (utilisé dans les noms de fichiers)   | `"iphone16"`         |
| `viewport.width` / `viewport.height` | Taille de la fenêtre Playwright (px)                     | `393` × `852`        |
| `deviceScaleFactor`                  | Densité de pixels (`1` = desktop, `3` = iPhone Retina)   | `3`                  |
| `isMobile`                           | Comportement mobile Playwright                           | `true`               |
| `label`                              | Nom affiché dans l’UI VR                                 | `"iPhone 16"`        |
| `icon`                               | Icône Material (`laptop`, `phone-iphone`, `tablet-mac`…) | `"phone-iphone"`     |
| `color`                              | Couleur dans l’UI (clé du thème du package)              | `"newTheme_primary"` |

Les champs `viewport` / `deviceScaleFactor` / `isMobile` servent à **Playwright**.  
Les champs `label` / `icon` / `color` servent à **l’interface web** de validation.

---

#### `capture` — vitesse et technique de capture

| Paramètre         | Défaut                     | En bref                                                                                                                                                  |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concurrency`     | `2`–`8` (selon CPU)        | Workers en Storybook **static** et en **CI**. Plus haut = plus rapide, plus de RAM. Override : `VR_CONCURRENCY`.                                         |
| `concurrencyDev`  | `2`                        | Workers en Storybook **dev** (Vite/HMR). Gardé bas pour ne pas saturer le serveur. Override : `VR_CONCURRENCY_DEV` (alias `VR_CAPTURE_DEV_CONCURRENCY`). |
| `maxTestTime`     | `10000`                    | Temps max (ms) pour attendre qu’une story soit « stable » avant le screenshot.                                                                           |
| `remoteChunkSize` | `20`                       | Nombre de captures envoyées **par lot** au daemon Docker. Augmentez (ex. `56`) pour une seule requête ; laissez `20` si vous avez des timeouts réseau.   |
| `backend`         | `"docker"`                 | `"docker"` = capture dans le conteneur (recommandé). `"local"` = Playwright sur votre machine (debug avancé).                                            |
| `daemonUrl`       | dérivé du projet (`18xxx`) | URL hôte du daemon. Omettre / laisser `http://localhost:2810` (sentinelle) → port déterministe. Override pour forcer un port.                            |

**Quel réglage s’applique ?**

| Contexte                        | Mode Storybook | Clé utilisée     | Env override         |
| ------------------------------- | -------------- | ---------------- | -------------------- |
| `yarn vr` en session locale HMR | `dev`          | `concurrencyDev` | `VR_CONCURRENCY_DEV` |
| `yarn vr` / compare en static   | `static`       | `concurrency`    | `VR_CONCURRENCY`     |
| Pipeline CI (souvent static)    | `static`       | `concurrency`    | `VR_CONCURRENCY`     |

Le log au démarrage du pool l’indique explicitement, ex. :

```text
⚡️ Pool de capture : 2 worker(s) [profil=dev · concurrencyDev=2 · concurrency(static/CI)=15] | 736 tâche(s) | mode full
```

**Variables d’env équivalentes** : `VR_CONCURRENCY`, `VR_CONCURRENCY_DEV`, `VR_MAX_TEST_TIME`, `VR_CAPTURE_REMOTE_CHUNK`, `VR_CAPTURE_BACKEND`, `VR_CAPTURE_DAEMON_URL`.

---

#### `compare` — quoi comparer et comment détecter les changements

| Paramètre                     | Défaut                                | En bref                                                                                                                                                            |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`                        | `"incremental"`                       | `"incremental"` = ne recapture que les stories impactées par vos changements git. `"full"` = tout recapturer à chaque run.                                         |
| `base`                        | `"origin/main"`                       | Branche ou commit git **de référence** pour savoir quels fichiers ont changé.                                                                                      |
| `scope`                       | `"all"`                               | `"all"` = branche + fichiers locaux (CI). `"working-tree"` = seulement vos modifs non poussées. `"branch"` = seulement les commits de la branche.                  |
| `includeWorkingTree`          | `true`                                | Si `true`, les fichiers modifiés localement (non commités) déclenchent une capture.                                                                                |
| `threshold`                   | `0`                                   | Tolérance pixelmatch (`0` = aucun pixel de différence toléré).                                                                                                     |
| `diffVerificationMaxAttempts` | `3`                                   | Si une diff est détectée, combien de **recaptures** pour confirmer (évite les faux positifs).                                                                      |
| `globalTriggers`              | voir défaut package                   | Liste de fichiers/globs : s’ils changent, **toutes** les stories sont recapturées (ex. `.storybook/`**, `package.json`).                                           |
| `statsFile`                   | `storybook-static/preview-stats.json` | Fichier stats Storybook pour TurboSnap (liens entre fichiers et stories).                                                                                          |
| `manifestPath`                | `.vr-cache/manifest.json`             | Cache local quand git n’est pas disponible.                                                                                                                        |
| `shardIndex` / `shardTotal`   | _(absent)_                            | **Sharding CI** : divise les stories entre plusieurs jobs (index **0-based**). En local, laissez absent. Préférez `VR_SHARD_INDEX` / `VR_SHARD_TOTAL` en pipeline. |

**Variable d’env équivalente** : `VR_COMPARE_MODE`, `VR_COMPARE_BASE`, `VR_COMPARE_SCOPE`, `VR_THRESHOLD`, `VR_DIFF_VERIFY_MAX_ATTEMPTS`, `VR_SHARD_INDEX`, `VR_SHARD_TOTAL`.

---

#### `launcher` — comportement de `yarn vr`

| Paramètre            | Défaut   | En bref                                                                                                                                                                                                |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runInitialCompare`  | `true`   | Lance une comparaison automatique au démarrage de `yarn vr`. Mettez `false` si vous voulez seulement ouvrir l’UI sans capturer.                                                                        |
| `storybookMode`      | _(auto)_ | `"dev"` = Storybook HMR (défaut local). `"static"` = build `storybook-static`. **Omis** = `dev`, sauf `@storybook/nextjs-vite` → `static`. Priorité : `VR_STORYBOOK_MODE` **>** ce champ **>** défaut. |
| `forceStaticRebuild` | `false`  | Si `true`, rebuild `storybook-static` avant chaque capture (mode static uniquement). Le rebuild se déclenche aussi dès qu’une story/source change (empreinte de contenu).                              |

**Variable d’env équivalente** : `VR_RUN_INITIAL_COMPARE`, `VR_STORYBOOK_MODE` (`dev` `static`), `VR_STORYBOOK_STATIC` (alias → `static`), `VR_STORYBOOK_STATIC_REBUILD`.

---

#### `storybook`

| Paramètre   | Défaut                     | En bref                                                                                                                                 |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `url`       | dérivé du projet (`16xxx`) | URL hôte Storybook (mapping Docker). Omettre / `http://localhost:6006` (sentinelle) → port déterministe. Override pour forcer un port.  |
| `configDir` | _(absent)_                 | Dossier `.storybook` (relatif à la racine). Monorepo : `apps/storybook/.storybook`. Définit `SBCONFIG_CONFIG_DIR` si l'env est absente. |

**Variable d’env équivalente** : `VR_STORYBOOK_URL`, `SBCONFIG_CONFIG_DIR` (prioritaire sur `configDir`).

---

#### `stabilize` — éviter les screenshots « qui flicker »

Réglages pour attendre que la story soit visuellement stable avant la capture. Voir aussi la section [SteadySnap](#steadysnap-anti-flake) et les tags Storybook (`burst-vr`, `live-animation-vr`, etc.).

| Paramètre            | Défaut  | En bref                                                                            |
| -------------------- | ------- | ---------------------------------------------------------------------------------- |
| `freezeAnimations`   | `true`  | Fige CSS **et** Reanimated web (`prefers-reduced-motion`) pendant la capture.      |
| `waitFonts`          | `true`  | Attend le chargement des polices.                                                  |
| `waitNetworkQuietMs` | `0`     | Attend X ms sans requête réseau (ex. `300` pour des stories qui chargent des API). |
| `maxStabilizeTime`   | `5000`  | Délai max total d’attente (ms).                                                    |
| `burstCapture`       | `false` | Prend plusieurs frames et garde la plus stable (global).                           |
| `burstFrames`        | `3`     | Nombre de frames si burst activé.                                                  |
| `burstIntervalMs`    | `100`   | Intervalle entre frames burst (ms).                                                |

Vous pouvez surcharger par story via `parameters.vr.stabilize` dans vos fichiers CSF.

---

#### `docker` — sidecar de capture _(avancé)_

| Paramètre         | Défaut                                      | En bref                                                                                                                               |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `image`           | `vr-capture:<playwright>`                   | Image du conteneur (tag = version Playwright de **capture**, auto-détectée).                                                          |
| `playwrightImage` | `mcr.microsoft.com/playwright:v<ver>-jammy` | Image de base pour **builder** le sidecar. Alignée automatiquement ; override `VR_PLAYWRIGHT_IMAGE`.                                  |
| `showLogs`        | `false`                                     | Si `true`, affiche les logs du sidecar (`docker compose logs -f`) dans le terminal hôte — pratique en dev sans ouvrir Docker Desktop. |

**Variable d’env équivalente** : `VR_DOCKER_IMAGE`, `VR_PLAYWRIGHT_IMAGE`, `VR_DOCKER_SHOW_LOGS` (`1` / `true` / `0` / `false`).

---

### Migration depuis `vr-devices.config.cjs`

Si vous aviez l’ancien format (tableau exporté directement), renommez le fichier en `vr.config.cjs` et enveloppez les devices :

```js
// Avant : module.exports = [ { name: "desktop-fhd", ... } ];
// Après :
module.exports = { devices: [ { name: "desktop-fhd", ... } ] };
```

Pas de rétrocompatibilité silencieuse : le package affiche un message explicite si `vr-devices.config.cjs` est encore présent sans `vr.config.cjs`.

Les scripts (serveur VR, comparaison Playwright) utilisent `name`, `viewport`, `deviceScaleFactor`, `isMobile`. L’UI utilise `name`, `label`, `icon`, `color`.

### SteadySnap (anti-flake)

Stabilisation des captures inspirée de [Chromatic SteadySnap](https://www.chromatic.com/blog/steadysnap/) — équivalent self-hosted, burst **opt-in** par défaut.

| Clé                            | Défaut  | Rôle                                                              |
| ------------------------------ | ------- | ----------------------------------------------------------------- |
| `stabilize.freezeAnimations`   | `true`  | Freeze CSS + Reanimated web (`prefers-reduced-motion` Playwright) |
| `stabilize.waitFonts`          | `true`  | Attend `document.fonts.ready`                                     |
| `stabilize.waitNetworkQuietMs` | `0`     | Fenêtre sans requête réseau (ms) avant capture                    |
| `stabilize.maxStabilizeTime`   | `5000`  | Plafond attente stabilisation                                     |
| `stabilize.burstCapture`       | `false` | Burst N frames pour toutes les stories                            |
| `stabilize.burstFrames`        | `3`     | Nombre de frames burst                                            |
| `stabilize.burstIntervalMs`    | `100`   | Intervalle entre frames burst                                     |

**Tags Storybook :**

- `live-animation-vr` — **opt-out** : conserve Reanimated en capture (défaut = figé via `prefers-reduced-motion`)
- `burst-vr` — burst SteadySnap côté Playwright (stories animées non figées)
- `skip-play-vr` — n'exécute pas `play()` en capture (opt-out du decorator preview)
- `ignore-vr` / `force-vr` — exclusion / inclusion forcée au compare

**Storybook preview :** en capture (`vr-capture=1`), le decorator fige les animations CSS. Playwright emule `prefers-reduced-motion: reduce` **avant** le `goto` iframe — Reanimated web lit cette MQ au chargement du module, donc `withTiming` / `withRepeat` sautent à l'état final (sans importer Reanimated dans l'entry Storybook, incompatible Vite). Un second decorator exécute `play()` puis pose `data-vr-ready="true"` sur `#storybook-root`.

**Modals / portals :** la capture cible `#storybook-root` (crop serré). Si un overlay est rendu **hors** du root (React portal, `Modal` RN Web, `[role="dialog"]`, `position: fixed|absolute` sibling), le clip est élargi à l’union root ∪ overlays — sinon on ne voit que le backdrop grisé sans le panneau modal.

**Stories** `play()` **:** l'iframe de capture ajoute `embed=true` (autoplay Storybook off) pour que `play()` tourne dans le decorator, **après** les `useEffect` des demos (sync props → state). Sans ça, le clic Storybook est écrasé et le screenshot fige l'état initial. Le decorator attend `data-vr-ready="true"` (stories taguées `play-fn`) et ne rejoue `play()` que s'il n'a pas déjà tourné — un second play casse l'état (spies, DOM déjà muté).

**Vérification diff :** si une capture diffère de la baseline, le moteur relance jusqu'à match ou `compare.diffVerificationMaxAttempts` (défaut 3). Override global : `VR_DIFF_VERIFY_MAX_ATTEMPTS`.

**Overrides par story (**`parameters.vr`**)** — fusionnés sur `vr.config.cjs` (meta ou story CSF) :

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

### Arbres UI (onglets, search / filtres)

L’UI gauche expose jusqu’à **trois onglets**, chacun alimenté par un endpoint d’arbre dédié :

| Onglet                 | Route                           | Contenu                                                                   | Visible                        |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| **Régressions**        | `GET /regressions/tree`         | stories `new` / `diff`                                                    | toujours                       |
| **Toutes les stories** | `GET /regressions/stories-tree` | catalogue Storybook × devices (`baseline` / `missing`, `ignored` = block) | toujours                       |
| **Orphelins**          | `GET /regressions/orphans-tree` | screenshots disque dont le `storyId` n’est plus dans `index.json`         | uniquement si `countTotal > 0` |

- **Search** (barre au-dessus de l’arbre) et **filtres de statut** (chips multi-sélection ; aucune chip = tout afficher) s’appliquent côté client via `filterTree` sur l’onglet actif (AND entre query et statuts). Orphelins : search seule.
- **Ordre d’affichage** : dans un dossier, les stories apparaissent avant les sous-dossiers.
- **Raccourcis arbre** : Maj+clic entre deux stories pour sélectionner la plage ; Option+clic (Alt) sur un accordéon pour ouvrir/fermer tous les sous-dossiers ; bouton tout déplier / tout replier.
- **Pas de poll** : le catalogue et les orphelins se rechargent au switch d’onglet, sur SSE `index-updated` / `connected`, ou via le bouton refresh du TreePanel. Anti-rebuild via `fingerprint` structurel (pas `Date.now()`).
- **Capture errors** : `GET /regressions/capture-errors` lit `.vr-cache/capture-errors.json` (mis à jour après chaque batch). Modal dédiée (icône erreur dans la top bar) pour régénérer cas par cas, sélection, ou toutes les erreurs (filtrable par device). Succès de capture (new / diff / match) → retrait de la liste.

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

### Monorepo (Storybook hub)

1. Un seul `vr.config.cjs` à la **racine** du monorepo, avec :

```js
storybook: {
  configDir: "apps/storybook/.storybook", // → SBCONFIG_CONFIG_DIR
},
```

2. Scripts VR à la racine (`vr`, `vr:compare`, `vr:capture:*`, …) sans préfixer `SBCONFIG_CONFIG_DIR=…`.
3. Les packages/apps délèguent à la racine (ex. `bash ../../scripts/vr-at-root.sh`) pour lancer la même CLI depuis n’importe quel workspace.
4. Les stories vivent dans les packages UI ; le hub `apps/storybook` les charge via `main.ts`.

### Prérequis navigateurs Playwright (mode local uniquement)

> **Avec** `yarn vr` **(comportement par défaut), cette étape n'est pas nécessaire.**  
> La capture passe par le sidecar Docker qui embarque déjà Chromium Linux (voir [Capture Docker](#capture-docker-obligatoire-reproductible) ci-dessous).

L'installation locale de Playwright ne concerne que le **mode fallback** `VR_CAPTURE_BACKEND=local` (tests internes du package ou désactivation explicite de Docker) :

```bash
cd <projet-hôte>
npx playwright install chromium
```

Sans ces binaires en mode local, la comparaison peut échouer avec `TimeoutError: launch: Timeout 180000ms exceeded`. Sur Windows, le script tente d'abord Edge/Chrome système avant Chromium bundlé (plus lent).

---

## Compatibilité Windows / macOS / Linux

| Plateforme                      | Workflow `yarn vr` | Captures (screenshots) | Notes                                                                                 |
| ------------------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| **Windows**                     | ✅                 | ✅ via Docker Linux    | Plus de workarounds (ports, signaux, chemins) ; Docker Desktop requis                 |
| **macOS Intel**                 | ✅                 | ✅ via Docker Linux    | Expérience généralement plus fluide                                                   |
| **macOS Apple Silicon (M1–M4)** | ✅                 | ✅ via Docker Linux    | Image `ghcr.io/.../vr-capture` publiée en **amd64 + arm64** (pas d'émulation au pull) |
| **Linux**                       | ✅                 | ✅ via Docker Linux    | Référence CI (`ubuntu-latest`)                                                        |

Les **screenshots sont identiques** sur toutes les machines : la capture s'exécute toujours dans le conteneur Linux (Chromium figé). Seule l'expérience développeur (démarrage Docker, signaux Ctrl+C, perf du 1er build) varie.

**CI** : chaque PR exécute les checks sur `ubuntu-latest` (`[ci.yml](.github/workflows/ci.yml)`), la validation statique sur **macOS et Windows** (`[platform.yml](.github/workflows/platform.yml)`), et l'intégration Docker sur Linux (`[integration.yml](.github/workflows/integration.yml)`).

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

`yarn vr` démarre automatiquement le sidecar (build de l'image au premier lancement), attend que le daemon soit prêt, puis lance le serveur VR, la comparaison initiale et l'UI. Une fois Storybook et l'UI Expo prêts, le launcher **ouvre (ou focalise) les deux URLs dans le navigateur** — uniquement si un onglet avec la même origine n'existe pas déjà (détection native sur macOS ; sinon ouverture classique). Expo est lancé avec `BROWSER=none` pour éviter un double onglet. Storybook tourne **dans le conteneur** (écoute interne `6006`) et est forwardé sur un **port hôte dérivé** de la racine du projet (plage `16000–16999`, daemon `18000–18999`). Plusieurs projets peuvent ainsi garder un sidecar chaud en parallèle sans collision. Override possible via `storybook.url` / `capture.daemonUrl` ou `VR_STORYBOOK_URL` / `VR_CAPTURE_DAEMON_URL`.

Commandes de contrôle du sidecar :

| Script                   | Rôle                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `yarn vr:capture:up`     | Démarre le sidecar + attend le daemon                            |
| `yarn vr:capture:down`   | Arrête le sidecar **de ce projet** (laisse les autres intacts)   |
| `yarn vr:capture:status` | État compose + health du daemon                                  |
| `yarn vr:kill-ports`     | Libère Expo/UI + ports Storybook/daemon **dérivés de ce projet** |

### Workflow CI

En CI, on utilise le mode **Storybook statique** (build unique, plus déterministe) en one-shot :

```bash
docker compose \
  -f node_modules/@setshao/visual-regression/docker/docker-compose.ci.yml \
  up --build --abort-on-container-exit --exit-code-from vr-capture
```

Un exemple complet GitHub Actions (cache `node_modules` + `storybook-static`, sharding, upload d'artefacts) est fourni pour les **projets hôte** : `[docker/ci/github-actions.example.yml](docker/ci/github-actions.example.yml)`.

> Ce dépôt lib dispose de ses propres workflows CI dans `[.github/workflows/](.github/workflows/)` (`ci.yml` sur chaque PR, `platform.yml` sur macOS/Windows, `integration.yml` sur les PR touchant les fichiers critiques). L'exemple ci-dessus est à copier dans le dépôt consommateur, pas dans ce package.

> **Source de vérité** : les baselines validées en Docker/CI font foi. Ne régénérez jamais une baseline depuis une capture native OS.

### Variables d'environnement Docker

| Variable                  | Défaut / `vr.config.cjs`         | Rôle                                                                                                   |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `VR_CAPTURE_BACKEND`      | `capture.backend` → `docker`     | `docker` = capture déléguée au daemon ; `local` = capture directe (tests internes / dans le conteneur) |
| `VR_CAPTURE_DAEMON_URL`   | `capture.daemonUrl`              | URL du daemon de capture                                                                               |
| `VR_CAPTURE_REMOTE_CHUNK` | `capture.remoteChunkSize` → `20` | Taille des lots envoyés au daemon (évite les timeouts fetch)                                           |
| `VR_STORYBOOK_MODE`       | `launcher.storybookMode` → `dev` | `dev` (HMR, défaut local) ou `static` (build + serve, CI)                                              |
| `VR_STORYBOOK_STATIC`     | alias → `static`                 | Rétrocompat : équivalent à `VR_STORYBOOK_MODE=static`                                                  |
| `VR_DOCKER_IMAGE`         | `docker.image`                   | Image du sidecar (tag aligné sur la version Playwright)                                                |
| `VR_PLAYWRIGHT_IMAGE`     | `docker.playwrightImage`         | Image de base Playwright pour builder le sidecar                                                       |
| `VR_DOCKER_SHOW_LOGS`     | `docker.showLogs` → `false`      | `1`/`true` = streamer les logs du sidecar dans le terminal hôte                                        |
| `VR_DOCKER`               | `1` (dans le conteneur)          | Active les flags Chromium déterministes                                                                |

### Utiliser son propre Docker (image maison)

L'image `ghcr.io/sashalarrieu/vr-capture` est un raccourci, pas une obligation. Vous pouvez fournir votre propre image (`VR_DOCKER_IMAGE`) tant qu'elle respecte le **contrat** :

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

### Intégration Storybook (`.storybook/`)

Le package expose les decorators, types et helpers utilisés par les stories VR :

| Import                                 | Rôle                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@setshao/visual-regression`           | Tags VR (`LIVE_ANIMATION_VR_TAG`, `SKIP_PLAY_VR_TAG`, …), type `VrStoryParameters`, helper `defineVrParameters`                         |
| `@setshao/visual-regression/types`     | Types seuls (`VrStoryParameters`, …) — idéal pour les `.d.ts` d’augmentation                                                            |
| `@setshao/visual-regression/storybook` | Decorators `vrPreviewDecorators` (freeze Reanimated + exécution `play()`) + `vrStorybookAddons` (retire `addon-vitest` dans le sidecar) |
| `@setshao/visual-regression/play`      | Helpers `play()` DOM pour React Native Web (`clickByLabel`, `expectText`, …)                                                            |

`.storybook/preview.tsx` :

```tsx
import type { Preview } from "@storybook/react-webpack5";
import { vrPreviewDecorators } from "@setshao/visual-regression/storybook";

const preview: Preview = {
  decorators: vrPreviewDecorators,
  parameters: { layout: "centered" },
};

export default preview;
```

`.storybook/main.ts` (si `@storybook/addon-vitest` est listé) :

```ts
import { vrStorybookAddons } from "@setshao/visual-regression/storybook";

const config = {
  addons: vrStorybookAddons(["@storybook/addon-docs", "@storybook/addon-vitest", "@storybook/addon-a11y"]),
};
```

Le sidecar `yarn vr` n’a pas de runner Vitest : sans ce filtre, le manager log `UniversalStoreFollowerTimeoutError` (`storybook/test`).

`.storybook/vr-parameters.d.ts` (typage `parameters.vr` — adapter le module au framework) :

```ts
import type { VrStoryParameters } from "@setshao/visual-regression/types";

// Stories qui importent Meta depuis @storybook/react :
declare module "@storybook/react" {
  interface ReactParameters {
    vr?: VrStoryParameters;
  }
}

// Framework Storybook (ex. nextjs-vite, react-webpack5, react-native-web-vite) :
declare module "@storybook/nextjs-vite" {
  interface Parameters {
    vr?: VrStoryParameters;
  }
}
```

Les tags `ignore-vr` / `force-vr` restent le filtre d'éligibilité via `index.json` (performant). `parameters.vr` sert aux overrides SteadySnap / diff verify.

Pour l’autocomplete **et** le rejet des clés inconnues dans les stories, préférez le helper (le typage natif `Parameters` de Storybook est trop permissif) :

```ts
import { defineVrParameters } from "@setshao/visual-regression";

const meta = {
  parameters: {
    vr: defineVrParameters({
      diffVerificationMaxAttempts: 2,
      stabilize: { burstCapture: true },
    }),
  },
} satisfies Meta<typeof MyComponent>;
```

Un modèle d’augmentation `.d.ts` est aussi fourni : `node_modules/@setshao/visual-regression/src/storybook/vr-parameters.d.ts`.

Ajoutez `@setshao/visual-regression` à `modulesToTranspile` de `@storybook/addon-react-native-web` si Storybook ne résout pas le package.

### 1. Scripts fournis par le package (à appeler depuis le projet hôte)

Le package contient ses scripts CLI dans `src/scripts/`, exposés via la commande `visual-regression`. Depuis le **projet hôte**, ajoute des scripts qui appellent le binaire (en lançant depuis la racine du projet pour que `process.cwd()` soit la racine) :

| Script                | Rôle                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `vr`                  | Lance tout : serveur VR + Storybook + Expo + comparaison incrémentale initiale (désactivable) |
| `vr:server`           | Lance uniquement le serveur VR (port 2805)                                                    |
| `vr:compare`          | Lance la comparaison Playwright (régénération des screenshots)                                |
| `vr:benchmark`        | Mesure la concurrency optimale sur 1 machine (`1..16`)                                        |
| `vr:benchmark-shards` | Simule le sharding CI (shardTotal × concurrency) sans lancer toute la matrix                  |
| `vr:app`              | Lance l’app Expo en mode régression (port 2804)                                               |
| `vr:capture:up`       | Démarre le sidecar Docker de capture (+ attend le daemon)                                     |
| `vr:capture:down`     | Arrête le sidecar Docker de capture                                                           |
| `vr:capture:status`   | État du sidecar + health du daemon (port hôte dérivé)                                         |
| `vr:kill-ports`       | Libère Expo `2804`, UI `2805`, et ports Storybook/daemon du projet courant                    |

> **Réservé au package** (ne pas exposer dans le `package.json` hôte) : `vr:test-incremental`, `vr:test-validation`, `vr:storybook:static`.

Exemple dans le `package.json` du projet hôte (à lancer depuis la racine du projet) :

```json
{
  "scripts": {
    "vr": "visual-regression",
    "vr:server": "visual-regression server",
    "vr:compare": "visual-regression compare",
    "vr:app": "visual-regression app"
  }
}
```

### 2. Variables d’environnement

| Variable                            | Description                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `VR_PROJECT_ROOT`                   | Racine du projet hôte (défaut : `process.cwd()`)                                     |
| `VR_CONCURRENCY`                    | Override de `capture.concurrency` (static / CI)                                      |
| `VR_CONCURRENCY_DEV`                | Override de `capture.concurrencyDev` (Storybook dev)                                 |
| `VR_CAPTURE_DEV_CONCURRENCY`        | Alias de `VR_CONCURRENCY_DEV` (rétrocompat)                                          |
| `VR_MAX_TEST_TIME`                  | Override de `capture.maxTestTime` (ms)                                               |
| `VR_COMPARE_MODE`                   | Override de `compare.mode` (`"incremental"` ou `"full"`)                             |
| `VR_COMPARE_SCOPE`                  | Override de `compare.scope` (`"all"`, `"branch"`, `"working-tree"`)                  |
| `VR_COMPARE_BASE`                   | Override de `compare.base` (ex. `origin/main`)                                       |
| `VR_THRESHOLD`                      | Override de `compare.threshold` (seuil pixelmatch)                                   |
| `VR_DIFF_VERIFY_MAX_ATTEMPTS`       | Override de `compare.diffVerificationMaxAttempts`                                    |
| `VR_RUN_INITIAL_COMPARE`            | Override de `launcher.runInitialCompare`                                             |
| `VR_STORYBOOK_MODE`                 | `"dev"` ou `"static"` — override de `launcher.storybookMode`                         |
| `VR_STORYBOOK_STATIC`               | Alias de `VR_STORYBOOK_MODE=static` (rétrocompatibilité)                             |
| `VR_STORYBOOK_STATIC_REBUILD`       | Override de `launcher.forceStaticRebuild` (`1` = rebuild forcé)                      |
| `VR_STORYBOOK_URL`                  | Override de `storybook.url`                                                          |
| `VR_SHARD_INDEX` / `VR_SHARD_TOTAL` | Sharding CI (index 0-based). Override de `compare.shardIndex` / `compare.shardTotal` |
| `VR_CAPTURE_BACKEND`                | Override de `capture.backend` (`docker` ou `local`)                                  |
| `VR_CAPTURE_DAEMON_URL`             | Override de `capture.daemonUrl`                                                      |
| `VR_CAPTURE_REMOTE_CHUNK`           | Override de `capture.remoteChunkSize`                                                |
| `VR_DOCKER_IMAGE`                   | Override de `docker.image`                                                           |
| `VR_PLAYWRIGHT_IMAGE`               | Override de `docker.playwrightImage`                                                 |
| `VR_DOCKER_SHOW_LOGS`               | Override de `docker.showLogs` (`1`/`true` ou `0`/`false`)                            |

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
yarn vr:test-validation              # checklist complète (démarre Storybook si besoin)
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

Un hook pre-commit Husky exécute `lint-staged` (Prettier + ESLint sur les fichiers stagés), puis `yarn lint` et `yarn format:check` sur tout le dépôt pour bloquer un commit si la CI échouerait.

### CI GitHub (ce dépôt)

| Workflow                                                     | Déclencheur                                 | Rôle                                                                  |
| ------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| `[ci.yml](.github/workflows/ci.yml)`                         | Chaque PR + push `main`                     | Typecheck, lint, format, tests unitaires, validation statique (Linux) |
| `[platform.yml](.github/workflows/platform.yml)`             | Chaque PR + push `main`                     | Typecheck + validation statique sur **macOS** et **Windows**          |
| `[integration.yml](.github/workflows/integration.yml)`       | PR modifiant scripts/utils/docker/demo/etc. | Capture VR Docker complète sur la demo (`VR_COMPARE_MODE=full`)       |
| `[docker-publish.yml](.github/workflows/docker-publish.yml)` | Tag `v*`                                    | Publication image `ghcr.io/sashalarrieu/vr-capture` (amd64 + arm64)   |

---

## Tester que tout fonctionne

### Test rapide (uniquement l’interface)

1. Dans le projet hôte : `yarn` (ou `npm install`) pour installer le lien vers `visual-regression` si tu es en local.
2. **Terminal 1** : `yarn vr:server` → serveur sur [http://localhost:2805](http://localhost:2805)
3. **Terminal 2** : `yarn vr:app` → app sur [http://localhost:2804](http://localhost:2804)
4. Ouvre [http://localhost:2804](http://localhost:2804) : tu dois voir l’interface (panneau « Régressions visuelles », zone de contenu). Au début, le message « Aucune regression détectée, ni nouvelle screenshot » est normal.

### Test complet (avec Storybook et comparaison)

Dans le projet hôte :

```bash
yarn vr
```

Puis ouvre [http://localhost:2804](http://localhost:2804) : après la comparaison, l’arbre des régressions et les screenshots doivent apparaître.

---

## Publier une nouvelle version sur npm

Prérequis :

- Node `>=20` (voir `engines` du package)
- Organisation npm `@setshao` configurée avec les droits de publication
- Secret GitHub `NPM_TOKEN` (token npm automation/publish)
- 2FA activée sur le compte npm

Workflow recommandé :

1. Vérifier les changements package : `yarn pack:check && yarn pack:verify`.
2. Mettre à jour `CHANGELOG.md`.
3. Incrémenter la version : `npm version patch` (ou `minor`/`major`).
4. Pousser commit + tag : `git push && git push --tags`.
5. Le workflow GitHub `npm-publish.yml` se déclenche sur tag `v*` et publie automatiquement sur npm.

Publication manuelle exceptionnelle (si nécessaire) :

1. `npm login`
2. `yarn prepublishOnly`
3. `npm publish`

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
  Vérifier que `node_modules/.bin/visual-regression` est présent. Si absent, réinstaller la dépendance (`yarn install` ou `yarn add @setshao/visual-regression`).

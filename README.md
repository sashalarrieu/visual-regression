# @setshao/visual-regression

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
  - Fournir une **configuration de devices** (`vr-devices.config.cjs` au format attendu).
  - Lancer les scripts `visual-regression` depuis la **racine** du projet (ou via `VR_PROJECT_ROOT`).

En résumé, `visual-regression` vise à **industrialiser la régression visuelle autour de Storybook**, avec un rôle minimal pour le projet hôte : configurer ses devices et lancer les scripts.

---

## Fonctionnement

- **Ce package** : app web de régression (UI intégrée), logique cliente (navigation dans les stories/devices, visualisation NEW / DIFF avec heatmap, validation/refus, historique), **et les scripts** (serveur VR, launcher, comparaison Playwright). Tout tourne en autonomie : le package ne laisse rien à maintenir dans le projet hôte côté scripts ou UI.
- **Le projet hôte** : à la racine, un fichier `vr-devices.config.cjs` et un dossier `.storybook/` pour Storybook. Le répertoire de screenshots (par défaut `public/`) est automatiquement créé/utilisé par le package si nécessaire. On lance les commandes VR depuis la **racine du projet hôte** (ou avec `VR_PROJECT_ROOT` pointant vers cette racine) ; les scripts du package utilisent alors cette racine pour charger la config et servir les fichiers.

**Prérequis côté projet hôte** : `vr-devices.config.cjs`, `.storybook/`. Les **devices** se configurent en format **Playwright** (voir section suivante). Le dossier `public/` est géré automatiquement par `visual-regression` (créé si absent).

---

## Devices (obligatoire)

L’utilisation de `@setshao/visual-regression` impose de **définir des devices** dans le projet hôte (ex. `vr-devices.config.cjs`). Chaque device doit inclure les champs viewport (pour les scripts de capture) **et** la personnalisation d’affichage (label, icon, color) pour l’UI :

```js
module.exports = [
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
    icon: "mobile",
    color: "newTheme_fantasy",
  },
];
```

- **label** : texte affiché dans l’UI.
- **icon** : nom de l’icône (ex. `"laptop"`, `"mobile"`, `"tablet-portrait"`, `"tablet-landscape"`).
- **color** : clé de couleur du thème (ex. `"newTheme_primary"`, `"newTheme_danger"`).

Les scripts (serveur VR, comparaison Playwright) utilisent `name`, `viewport`, `deviceScaleFactor`, `isMobile`. L’UI utilise `name`, `label`, `icon`, `color` via la prop **obligatoire** `devices`, construite avec `fromVRDeviceConfig(config)`.

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

---

## Utilisation dans un projet hôte

Dans l’utilisation standard, tu **n’as rien à importer dans ton app** : tu lances les scripts depuis la racine du projet hôte et tu ouvres l’URL de l’app web de régression dans ton navigateur.  
L’UI VisualRegressions est entièrement embarquée dans le package.

### 1. Scripts fournis par le package (à appeler depuis le projet hôte)

Le package contient les scripts dans `scripts/`. Depuis le **projet hôte**, ajoute dans ton `package.json` des scripts qui pointent vers le package (en lançant depuis la racine du projet pour que `process.cwd()` soit la racine) :

| Script       | Rôle |
|-------------|------|
| `vr`        | Lance tout : serveur VR + Storybook + Expo en mode VR + comparaison initiale |
| `vr:server` | Lance uniquement le serveur VR (port 2805) |
| `vr:compare`| Lance la comparaison Playwright (régénération des screenshots) |
| `vr:app`    | Lance l’app Expo en mode régression (port 2804) |
| `vr:kill-ports` | Libère les ports 2804 et 2805 |

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

| Variable           | Description |
|--------------------|-------------|
| `VR_PROJECT_ROOT`  | Racine du projet hôte (défaut : `process.cwd()`) |

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

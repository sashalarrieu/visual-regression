# Tester le package visual-regression

## Prérequis

- Le projet **EIWIE_PRO_FRONTEND** doit avoir la dépendance :
  ```json
  "visual-regression": "file:../visual-regression"
  ```
- Les deux dossiers doivent être côte à côte : `eiwie/visual-regression` et `eiwie/EIWIE_PRO_FRONTEND`.

---

## 1. Installer les dépendances (une fois)

```bash
cd EIWIE_PRO_FRONTEND
yarn
```

Cela crée le lien vers `visual-regression` dans `node_modules`.

---

## 2. Test rapide : uniquement l’interface VR

Vérifier que l’écran de régression s’affiche (sans lancer toute la chaîne Storybook / comparaison).

**Terminal 1 – serveur VR :**
```bash
cd EIWIE_PRO_FRONTEND
yarn vr:server
```
→ Le serveur tourne sur http://localhost:2805

**Terminal 2 – app Expo en mode VR :**
```bash
cd EIWIE_PRO_FRONTEND
yarn vr:app
```
→ L’app Expo (web) tourne sur http://localhost:2804

Ouvre **http://localhost:2804** dans le navigateur.

- Tu dois voir l’interface de régression (panneau de gauche « Régressions visuelles », zone de contenu à droite).
- Au début, le message attendu est : **« Aucune regression détectée, ni nouvelle screenshot »** (normal si aucune capture n’a encore été faite).

Si cette page s’affiche, le package **visual-regression** est bien utilisé et fonctionne.

---

## 3. Test complet (avec Storybook et comparaison)

Pour enchaîner : serveur VR + Storybook + Expo + comparaison initiale (Playwright).

**Un seul terminal :**
```bash
cd EIWIE_PRO_FRONTEND
yarn vr
```

Cela lance :
1. Le serveur VR (port 2805)
2. Storybook (port 6006)
3. L’app Expo en mode VR (port 2804)
4. Une première comparaison visuelle

Ensuite ouvre **http://localhost:2804** : après la comparaison, l’arbre des régressions et les screenshots devraient apparaître.

---

## Dépannage

- **« Cannot find module 'visual-regression' »**  
  Vérifier que `yarn` a bien été exécuté dans `EIWIE_PRO_FRONTEND` et que `node_modules/visual-regression` existe (lien vers `../visual-regression`).

- **Interface blanche ou crash au chargement**  
  Vérifier la console du navigateur (F12). Si le serveur VR n’est pas démarré, l’app peut afficher « Aucune regression détectée » ; lancer `yarn vr:server` dans un autre terminal.

- **Port déjà utilisé**  
  Utiliser `yarn vr:kill-ports` pour libérer les ports 2804 et 2805, puis relancer.

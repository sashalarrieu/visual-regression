#!/usr/bin/env sh
# Entrypoint du sidecar de capture VR.
# 1. Installe les dépendances du projet hôte dans le volume node_modules (si le lockfile a changé).
# 2. Lance le daemon de capture (Storybook + serveur HTTP /capture/batch).
set -e

cd "${VR_PROJECT_ROOT:-/work}"

CACHE_DIR=".vr-cache"
HASH_FILE="$CACHE_DIR/docker-deps.hash"
mkdir -p "$CACHE_DIR"

detect_lockfile() {
  if [ -f yarn.lock ]; then echo "yarn.lock";
  elif [ -f pnpm-lock.yaml ]; then echo "pnpm-lock.yaml";
  elif [ -f package-lock.json ]; then echo "package-lock.json";
  else echo ""; fi
}

LOCKFILE=$(detect_lockfile)

install_deps() {
  case "$LOCKFILE" in
    yarn.lock) yarn install --frozen-lockfile ;;
    pnpm-lock.yaml) corepack pnpm install --frozen-lockfile ;;
    package-lock.json) npm ci ;;
    *) npm install ;;
  esac
}

NEW_HASH=""
if [ -n "$LOCKFILE" ]; then
  NEW_HASH=$(sha1sum "$LOCKFILE" | awk '{print $1}')
fi

# Invalider le cache si une dépendance file: locale change (ex. visual-regression monté dans Docker).
if [ -f /visual-regression/package.json ]; then
  LINKED_HASH=$(sha1sum /visual-regression/package.json | awk '{print $1}')
  if [ -d /visual-regression/src ]; then
    SRC_HASH=$(find /visual-regression/src /visual-regression/bin -type f 2>/dev/null | sort | xargs sha1sum 2>/dev/null | sha1sum | awk '{print $1}')
    LINKED_HASH="${LINKED_HASH}${SRC_HASH}"
  fi
  NEW_HASH="${NEW_HASH}${LINKED_HASH}"
fi

OLD_HASH=""
if [ -f "$HASH_FILE" ]; then
  OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")
fi

if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ] || [ "$OLD_HASH" != "$NEW_HASH" ]; then
  echo "📦 [vr-docker] Installation des dépendances (${LOCKFILE:-npm})…"
  install_deps
  echo "$NEW_HASH" > "$HASH_FILE"
else
  echo "✅ [vr-docker] Dépendances à jour (skip install)"
fi

# Sous-commande CLI à lancer : daemon (dev, défaut) ou oneshot (CI).
CMD="${VR_ENTRYPOINT_CMD:-capture-daemon}"

# Lancement via la CLI du package (résolue selon le contexte).
if [ -x node_modules/.bin/visual-regression ]; then
  exec node_modules/.bin/visual-regression "$CMD"
elif [ -f bin/visual-regression.mjs ]; then
  exec node bin/visual-regression.mjs "$CMD"
else
  echo "❌ [vr-docker] CLI visual-regression introuvable (ni node_modules/.bin ni bin/)."
  exit 1
fi

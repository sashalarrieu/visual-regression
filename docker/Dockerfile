# Image de capture VR reproductible.
# Base officielle Playwright (navigateurs préinstallés, version alignée sur le package).
# Image publiée multi-arch (linux/amd64 + linux/arm64) pour Mac Apple Silicon natif.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# Environnement de capture déterministe. Le code du projet hôte est monté sur /work
# (bind mount) ; node_modules Linux vit dans un volume nommé (voir docker-compose.yml).
ENV VR_DOCKER=1 \
    VR_PROJECT_ROOT=/work \
    VR_CAPTURE_BACKEND=local \
    VR_STORYBOOK_MODE=dev \
    CI=1

# corepack fournit yarn/pnpm (Node est inclus dans l'image de base).
RUN corepack enable || true

WORKDIR /work

# Seul l'entrypoint est copié dans l'image ; le code arrive via volume mount.
COPY entrypoint.sh /usr/local/bin/vr-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/vr-entrypoint.sh && chmod +x /usr/local/bin/vr-entrypoint.sh

# 6006 = Storybook, 2810 = daemon de capture.
EXPOSE 6006 2810

ENTRYPOINT ["/usr/local/bin/vr-entrypoint.sh"]

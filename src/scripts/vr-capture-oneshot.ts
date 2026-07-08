/**
 * Capture VR one-shot dans le conteneur (CI).
 *
 * Démarre Storybook (statique par défaut en CI), lance la comparaison complète
 * en local (backend "local" — vraie capture Playwright), puis s'arrête.
 * Contrairement au daemon, ne garde pas de serveur HTTP vivant.
 */
import { STORYBOOK_PORT } from "@constants/constants";
import { compareVisualRegressions } from "@scripts/compare-visual-regressions";
import { getProjectRoot, resolveVrConfig } from "@utils/node";
import { getStorybookMode, startStorybook } from "@utils/vr-storybook-runtime";

// Backend "local" : vraie capture Playwright dans le conteneur (lu à l'exécution).
process.env.VR_CAPTURE_BACKEND = "local";

const PROJECT_ROOT = getProjectRoot();

const parseStorybookPort = (storybookUrl: string): number => {
  try {
    const port = new URL(storybookUrl).port;
    return port ? Number(port) : STORYBOOK_PORT;
  } catch {
    return STORYBOOK_PORT;
  }
};

const main = async (): Promise<void> => {
  const config = resolveVrConfig(PROJECT_ROOT);
  const storybookPort = parseStorybookPort(config.storybook.url);
  // En CI, mode statique par défaut si non précisé.
  const mode = process.env.VR_STORYBOOK_MODE ? getStorybookMode() : "static";

  console.log(`🐳 [vr-oneshot] Capture one-shot (mode Storybook: ${mode})`);

  const storybook = await startStorybook({
    projectRoot: PROJECT_ROOT,
    port: storybookPort,
    mode,
    statsFile: config.compare.statsFile,
  });

  if (!storybook.ready) {
    console.error("❌ [vr-oneshot] Storybook n'a pas indexé les stories à temps");
    process.exit(1);
  }

  console.log(`✅ [vr-oneshot] Storybook prêt (port ${storybookPort}) — lancement de la comparaison`);

  // compareVisualRegressions gère lui-même process.exit selon le résultat.
  await compareVisualRegressions();
};

main().catch(err => {
  console.error("❌ [vr-oneshot] Erreur fatale:", err);
  process.exit(1);
});

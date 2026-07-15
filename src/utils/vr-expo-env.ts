/**
 * Variables d'environnement pour lancer Expo depuis le package publié.
 *
 * Les devDependencies du package (eslint-config-expo, typescript, etc.) ne sont pas
 * installées chez un consommateur npm/pnpm. Expo doctor les détecte pourtant dans
 * package.json et échoue avec ENEEDAUTH / CommandError.
 */
export const getExpoSpawnEnv = (base: NodeJS.ProcessEnv, projectRoot: string): NodeJS.ProcessEnv => ({
  ...base,
  VR_PROJECT_ROOT: projectRoot,
  EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK: "1",
  /** DevDeps du package (eslint-config-expo, etc.) absentes chez les consommateurs npm/pnpm. */
  EXPO_NO_DEPENDENCY_VALIDATION: "1",
});

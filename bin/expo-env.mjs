/**
 * Miroir ESM de src/utils/vr-expo-env.ts pour bin/visual-regression.mjs.
 * @param {NodeJS.ProcessEnv} base
 * @param {string} projectRoot
 */
export const getExpoSpawnEnv = (base, projectRoot) => ({
  ...base,
  VR_PROJECT_ROOT: projectRoot,
  EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK: "1",
  EXPO_NO_DEPENDENCY_VALIDATION: "1",
});

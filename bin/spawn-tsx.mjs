/**
 * Lance un script TypeScript via tsx de façon fiable (pnpm, chemins Windows avec espaces).
 */
import { spawn } from "child_process";
import { createRequire } from "module";
import { existsSync, realpathSync } from "fs";
import path from "path";

export const TSX_TSCONFIG_ENV = "TSX_TSCONFIG_PATH";

const tsxCliRel = path.join("tsx", "dist", "cli.mjs");

const resolveTsxFromPackageJson = pkgJsonPath => {
  try {
    if (!existsSync(pkgJsonPath)) return null;
    const realPkg = realpathSync(pkgJsonPath);
    const req = createRequire(realPkg);
    const tsxPkg = req.resolve("tsx/package.json");
    return path.join(path.dirname(tsxPkg), "dist", "cli.mjs");
  } catch {
    return null;
  }
};

/** Résout le CLI tsx (layout npm/yarn/pnpm, y compris file: + realpath). */
export function getTsxCliPath(hostRoot, packageRoot) {
  const candidates = [
    resolveTsxFromPackageJson(path.join(hostRoot, "node_modules", "@setshao", "visual-regression", "package.json")),
    resolveTsxFromPackageJson(path.join(packageRoot, "package.json")),
  ];

  let dir = packageRoot;
  for (let depth = 0; depth < 12 && dir; depth += 1) {
    candidates.push(path.join(dir, "node_modules", tsxCliRel));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Spawn node + tsx sans --tsconfig CLI (TSX_TSCONFIG_PATH évite les espaces sous shell Windows). */
export function spawnTsxScript({
  hostRoot,
  packageRoot,
  tsconfigPath,
  scriptPath,
  scriptArgs = [],
  cwd,
  env = {},
  stdio = "inherit",
}) {
  const tsxCli = getTsxCliPath(hostRoot, packageRoot);
  const runCwd = cwd ?? packageRoot;
  const mergedEnv = { ...process.env, ...env };
  if (tsconfigPath) {
    mergedEnv[TSX_TSCONFIG_ENV] = tsconfigPath;
  }

  if (tsxCli) {
    return spawn("node", [tsxCli, scriptPath, ...scriptArgs], {
      cwd: runCwd,
      env: mergedEnv,
      stdio,
      shell: false,
    });
  }

  const isWin = process.platform === "win32";
  const npxRunner = isWin ? "npx.cmd" : "npx";
  return spawn(npxRunner, ["tsx", scriptPath, ...scriptArgs], {
    cwd: runCwd,
    env: mergedEnv,
    stdio,
    ...(isWin && { shell: true }),
  });
}

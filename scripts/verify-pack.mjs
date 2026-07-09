import { execSync } from "node:child_process";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function fail(message) {
  console.error(`pack:verify failed - ${message}`);
  process.exit(1);
}

function runPackJson() {
  try {
    const output = execSync("npm pack --dry-run --ignore-scripts --json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fail("npm pack --json a retourne une sortie vide.");
    }
    return parsed[0];
  } catch (error) {
    fail(error instanceof Error ? error.message : "erreur inconnue.");
  }
}

const packResult = runPackJson();
const files = Array.isArray(packResult.files) ? packResult.files.map(entry => entry.path) : [];
const fileSet = new Set(files);

const requiredFiles = ["src/index.ts", "tsconfig.json", "babel.config.cjs", "LICENSE"];

for (const required of requiredFiles) {
  if (!fileSet.has(required)) {
    fail(`fichier requis absent du tarball: ${required}`);
  }
}

const forbiddenPrefixes = ["src/demo/"];
const forbiddenSuffixes = [".test.ts"];

for (const file of files) {
  if (forbiddenPrefixes.some(prefix => file.startsWith(prefix))) {
    fail(`fichier interdit trouve dans le tarball: ${file}`);
  }
  if (forbiddenSuffixes.some(suffix => file.endsWith(suffix))) {
    fail(`fichier de test publie par erreur: ${file}`);
  }
}

if (typeof packResult.unpackedSize === "number" && packResult.unpackedSize > MAX_SIZE_BYTES) {
  fail(`taille du tarball trop grande (${packResult.unpackedSize} bytes > ${MAX_SIZE_BYTES} bytes).`);
}

console.log(
  `pack:verify OK - ${files.length} fichiers, taille decompressee ${packResult.unpackedSize || "inconnue"} bytes.`,
);

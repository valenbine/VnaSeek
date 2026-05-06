import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopRoot, "..");

const sourceBackendDir = path.join(projectRoot, "beat_analyzer");
const resourcesDir = path.join(desktopRoot, "resources");
const targetBackendDir = path.join(resourcesDir, "backend");
const targetDepsDir = path.join(resourcesDir, "backend-deps");
const targetPythonDir = path.join(resourcesDir, "python");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const normalized = src.replaceAll("\\", "/");
      if (normalized.includes("/__pycache__/")) return false;
      if (normalized.endsWith("/__pycache__")) return false;
      if (normalized.includes("/.git/")) return false;
      return true;
    }
  });
}

ensureDir(resourcesDir);
copyDir(sourceBackendDir, targetBackendDir);
ensureDir(targetDepsDir);
ensureDir(targetPythonDir);

console.log(`Prepared backend resources at: ${targetBackendDir}`);
console.log(`Dependency placeholder at: ${targetDepsDir}`);
console.log(`Embedded Python placeholder at: ${targetPythonDir}`);

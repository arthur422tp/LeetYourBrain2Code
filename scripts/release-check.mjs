import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_DIST_FILES = Object.freeze([
  "manifest.json",
  "sidepanel/index.html",
  "worker/pyodide-worker.js",
  "content/leetcode-adapter.js",
  "page-bridge/leetcode-main-world.js",
  "background/service-worker.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "pyodide/pyodide.asm.js",
  "pyodide/pyodide.asm.wasm",
  "pyodide/python_stdlib.zip",
  "pyodide/pyodide-lock.json"
]);

const EXPECTED_PERMISSIONS = ["sidePanel", "scripting"];
const EXPECTED_HOST_PERMISSIONS = ["https://leetcode.com/*"];
const EXPECTED_ICONS = {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
};
const EXPECTED_ACTION = {
  default_title: "Open LeetCode Python Execution Visualizer",
  default_icon: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png"
  }
};
const EXPECTED_SIDE_PANEL = { default_path: "sidepanel/index.html" };
const EXPECTED_BACKGROUND = {
  service_worker: "background/service-worker.js",
  type: "module"
};
const FORBIDDEN_RELEASE_SEGMENTS = new Set([
  "src",
  "tests",
  "docs",
  "node_modules",
  ".git"
]);

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function relativePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

export function listReleaseFiles(root) {
  if (!existsSync(root)) fail(`Release root does not exist: ${root}`);

  const files = [];
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        fail(`Release root cannot contain symbolic links: ${relativePath(root, fullPath)}`);
      }
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(relativePath(root, fullPath));
      } else {
        fail(`Release root contains an unsupported filesystem entry: ${relativePath(root, fullPath)}`);
      }
    }
  };

  visit(root);
  return files.sort();
}

export function assertReleaseRootIsSafe(root) {
  for (const file of listReleaseFiles(root)) {
    const segments = file.split("/");
    if (segments.some((segment) => FORBIDDEN_RELEASE_SEGMENTS.has(segment))) {
      fail(`Release root contains a forbidden path: ${file}`);
    }
    if (file.endsWith(".log")) {
      fail(`Release root contains a log file: ${file}`);
    }
  }
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

function scanHtmlForRemoteScripts(relativePathValue, contents) {
  const findings = [];
  const withoutComments = contents.replace(/<!--[\s\S]*?-->/g, "");
  const pattern = /<script\b[^>]*\bsrc\s*=\s*(["'])https?:\/\//gi;
  for (const match of withoutComments.matchAll(pattern)) {
    findings.push(`${relativePathValue}:${lineNumberAt(withoutComments, match.index ?? 0)}`);
  }
  return findings;
}

function isIdentifierStart(character) {
  return /[A-Za-z_$]/.test(character ?? "");
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character ?? "");
}

function scanJavaScriptForRemoteScripts(relativePathValue, contents) {
  const findings = [];
  let index = 0;

  while (index < contents.length) {
    const character = contents[index];
    const next = contents[index + 1];

    if (character === "/" && next === "/") {
      index += 2;
      while (index < contents.length && contents[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < contents.length && !(contents[index] === "*" && contents[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(contents.length, index + 2);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      index += 1;
      while (index < contents.length) {
        if (contents[index] === "\\") {
          index += 2;
          continue;
        }
        if (contents[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (!isIdentifierStart(character)) {
      index += 1;
      continue;
    }

    const identifierStart = index;
    index += 1;
    while (index < contents.length && isIdentifierPart(contents[index])) index += 1;
    const identifier = contents.slice(identifierStart, index);
    if (identifier !== "import" && identifier !== "importScripts") continue;

    let cursor = index;
    while (/\s/.test(contents[cursor] ?? "")) cursor += 1;
    if (contents[cursor] !== "(") continue;
    cursor += 1;
    while (/\s/.test(contents[cursor] ?? "")) cursor += 1;
    const quote = contents[cursor];
    if (quote !== "'" && quote !== '"') continue;
    cursor += 1;
    const urlStart = cursor;
    while (cursor < contents.length && contents[cursor] !== quote) {
      if (contents[cursor] === "\\") cursor += 2;
      else cursor += 1;
    }
    const url = contents.slice(urlStart, cursor);
    if (/^https?:\/\//i.test(url)) {
      findings.push(`${relativePathValue}:${lineNumberAt(contents, identifierStart)}`);
    }
  }

  return findings;
}

export function findRemoteExecutableUrls(relativePathValue, contents) {
  const extension = extname(relativePathValue).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return scanHtmlForRemoteScripts(relativePathValue, contents);
  }
  if (extension === ".js" || extension === ".mjs") {
    return scanJavaScriptForRemoteScripts(relativePathValue, contents);
  }
  return [];
}

function assertEqual(label, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label} mismatch.\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
  }
}

export function validateSourceManifest(projectRoot = PROJECT_ROOT) {
  const manifestPath = resolve(projectRoot, "public/manifest.json");
  const packagePath = resolve(projectRoot, "package.json");
  const manifest = readJson(manifestPath);
  const packageJson = readJson(packagePath);

  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version ?? "")) {
    fail(`package.json version must be semver: ${packageJson.version}`);
  }
  if (manifest.version !== packageJson.version) {
    fail(`Manifest/package version mismatch: ${manifest.version} != ${packageJson.version}`);
  }
  if (manifest.manifest_version !== 3) fail("Release manifest must use Manifest V3");
  if (manifest.minimum_chrome_version !== "114") {
    fail(`Release manifest must declare minimum_chrome_version 114, got ${manifest.minimum_chrome_version}`);
  }
  assertEqual("permissions", manifest.permissions, EXPECTED_PERMISSIONS);
  assertEqual("host_permissions", manifest.host_permissions, EXPECTED_HOST_PERMISSIONS);
  assertEqual("icons", manifest.icons, EXPECTED_ICONS);
  assertEqual("action", manifest.action, EXPECTED_ACTION);
  assertEqual("side_panel", manifest.side_panel, EXPECTED_SIDE_PANEL);
  assertEqual("background", manifest.background, EXPECTED_BACKGROUND);
  assertEqual(
    "content script matches",
    (manifest.content_scripts ?? []).map((script) => script.matches),
    [["https://leetcode.com/*"], ["https://leetcode.com/*"]]
  );
  if (manifest.content_security_policy?.extension_pages !== "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'") {
    fail("Manifest CSP must keep bundled Pyodide execution local and explicit");
  }

  return { version: packageJson.version, manifest, packageJson };
}

export function validateBuiltPackage(projectRoot = PROJECT_ROOT) {
  const source = validateSourceManifest(projectRoot);
  const distRoot = resolve(projectRoot, "dist");
  if (!existsSync(distRoot)) fail(`Built release directory does not exist: ${distRoot}`);

  const distManifest = readJson(resolve(distRoot, "manifest.json"));
  assertEqual("built manifest", distManifest, source.manifest);
  for (const requiredFile of REQUIRED_DIST_FILES) {
    const path = resolve(distRoot, requiredFile);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      fail(`Built release is missing required file: ${requiredFile}`);
    }
  }

  const files = listReleaseFiles(distRoot);
  assertReleaseRootIsSafe(distRoot);
  const findings = [];
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (extension !== ".html" && extension !== ".htm" && extension !== ".js" && extension !== ".mjs") {
      continue;
    }
    findings.push(...findRemoteExecutableUrls(file, readFileSync(resolve(distRoot, file), "utf8")));
  }
  if (findings.length > 0) {
    fail(`Built release contains remote executable code:\n${findings.join("\n")}`);
  }

  return {
    version: source.version,
    distRoot,
    files,
    sourceManifest: source.manifest
  };
}

export function validateReleasePackage(projectRoot = PROJECT_ROOT) {
  return validateBuiltPackage(projectRoot);
}

export function getSourceCommit(projectRoot = PROJECT_ROOT) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8"
    }).trim();
  } catch {
    return "unknown";
  }
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const summary = validateReleasePackage();
    console.log("Release package check passed");
    console.log(`version: ${summary.version}`);
    console.log(`source commit: ${getSourceCommit()}`);
    console.log(`file count: ${summary.files.length}`);
  } catch (error) {
    console.error(`Release package check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

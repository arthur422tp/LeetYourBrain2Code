import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import {
  PROJECT_ROOT,
  assertReleaseRootIsSafe,
  getSourceCommit,
  listReleaseFiles,
  validateReleasePackage
} from "./release-check.mjs";

const RELEASE_PREFIX = "leetcode-python-execution-visualizer";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(name, data, compressed) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}

function centralDirectoryHeader(name, data, compressed, localOffset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBytes.copy(header, 46);
  return header;
}

function endOfCentralDirectory(entryCount, size, offset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

export function createDeterministicZip(root) {
  assertReleaseRootIsSafe(root);
  const files = listReleaseFiles(root);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const data = readFileSync(join(root, ...file.split("/")));
    const compressed = deflateRawSync(data, { level: 9 });
    const local = localFileHeader(file, data, compressed);
    localParts.push(local, compressed);
    centralParts.push(centralDirectoryHeader(file, data, compressed, localOffset));
    localOffset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory(files.length, centralDirectory.length, localOffset)
  ]);
}

export function writeReleaseZip(projectRoot = PROJECT_ROOT) {
  const summary = validateReleasePackage(projectRoot);
  const outputPath = resolve(
    projectRoot,
    "release",
    `${RELEASE_PREFIX}-v${summary.version}.zip`
  );
  const archive = createDeterministicZip(summary.distRoot);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, archive);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return {
    ...summary,
    outputPath,
    zipBytes: archive.length,
    sha256,
    sourceCommit: getSourceCommit(projectRoot)
  };
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const summary = writeReleaseZip();
    console.log("Release ZIP generated");
    console.log(`version: ${summary.version}`);
    console.log(`source commit: ${summary.sourceCommit}`);
    console.log(`file count: ${summary.files.length}`);
    console.log(`ZIP byte size: ${summary.zipBytes}`);
    console.log(`SHA-256: ${summary.sha256}`);
    console.log(`path: ${summary.outputPath}`);
  } catch (error) {
    console.error(`Release ZIP failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

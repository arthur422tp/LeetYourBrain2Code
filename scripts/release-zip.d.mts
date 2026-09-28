export const RELEASE_PREFIX: string;
export function getReleaseZipPath(projectRoot: string, version: string): string;
export function createDeterministicZip(root: string): Buffer;
export function writeReleaseZip(projectRoot?: string): {
  version: string;
  distRoot: string;
  files: string[];
  sourceManifest: unknown;
  outputPath: string;
  zipBytes: number;
  sha256: string;
  sourceCommit: string;
};

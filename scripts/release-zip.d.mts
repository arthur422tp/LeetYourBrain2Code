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


export const PROJECT_ROOT: string;
export const REQUIRED_DIST_FILES: readonly string[];
export function listReleaseFiles(root: string): string[];
export function assertReleaseRootIsSafe(root: string): void;
export function findRemoteExecutableUrls(relativePath: string, contents: string): string[];
export function validateSourceManifest(projectRoot?: string): { version: string };
export function validateBuiltPackage(projectRoot?: string): {
  version: string;
  distRoot: string;
  files: string[];
  sourceManifest: unknown;
};
export function validateReleasePackage(projectRoot?: string): ReturnType<typeof validateBuiltPackage>;
export function getSourceCommit(projectRoot?: string): string;


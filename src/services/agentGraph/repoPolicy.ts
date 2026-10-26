export interface RepositoryPolicy {
  maxChangedFiles?: number;
  protectedPaths?: string[];
}

// Used only when no toolchain is known; normally the toolchain's
// protectedPaths (its manifests and lockfiles) are the default.
export const DEFAULT_PROTECTED_PATHS = ["package.json", "package-lock.json", ".github"];
const DEFAULT_MAX_CHANGED_FILES = 20;

/** True when `file` is a protected path or lies inside one. */
export const isProtectedPath = (file: string, protectedPaths: string[]) =>
  protectedPaths.some(
    (protectedPath) =>
      file === protectedPath || file.startsWith(`${protectedPath}/`),
  );

/**
 * Returns feedback the agent can act on, or undefined when the change is
 * allowed. Violations are retried like failed verification, not thrown.
 */
export const checkRepositoryPolicy = (
  files: string[],
  policy: RepositoryPolicy | null | undefined,
  defaultProtectedPaths = DEFAULT_PROTECTED_PATHS,
): string | undefined => {
  const maxChangedFiles = policy?.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  const protectedPaths = policy?.protectedPaths ?? defaultProtectedPaths;

  const issues: string[] = [];
  if (files.length > maxChangedFiles)
    issues.push(
      `The change touches ${files.length} files; the limit is ${maxChangedFiles}. Make a smaller change.`,
    );
  const protectedFiles = files.filter((file) =>
    isProtectedPath(file, protectedPaths),
  );
  if (protectedFiles.length)
    issues.push(
      `The change modifies protected paths: ${protectedFiles.join(", ")}. Do not change: ${protectedPaths.join(", ")}.`,
    );

  return issues.length
    ? `Repository policy rejected the change. ${issues.join(" ")}`
    : undefined;
};

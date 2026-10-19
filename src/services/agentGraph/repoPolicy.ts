export interface RepositoryPolicy {
  maxChangedFiles?: number;
  protectedPaths?: string[];
}

const DEFAULT_PROTECTED_PATHS = ["package.json", "package-lock.json", ".github"];
const DEFAULT_MAX_CHANGED_FILES = 20;

/**
 * Returns feedback the agent can act on, or undefined when the change is
 * allowed. Violations are retried like failed verification, not thrown.
 */
export const checkRepositoryPolicy = (
  files: string[],
  policy: RepositoryPolicy | null | undefined,
): string | undefined => {
  const maxChangedFiles = policy?.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  const protectedPaths = policy?.protectedPaths ?? DEFAULT_PROTECTED_PATHS;

  const issues: string[] = [];
  if (files.length > maxChangedFiles)
    issues.push(
      `The change touches ${files.length} files; the limit is ${maxChangedFiles}. Make a smaller change.`,
    );
  const protectedFiles = files.filter((file) =>
    protectedPaths.some(
      (protectedPath) =>
        file === protectedPath || file.startsWith(`${protectedPath}/`),
    ),
  );
  if (protectedFiles.length)
    issues.push(
      `The change modifies protected paths: ${protectedFiles.join(", ")}. Do not change: ${protectedPaths.join(", ")}.`,
    );

  return issues.length
    ? `Repository policy rejected the change. ${issues.join(" ")}`
    : undefined;
};

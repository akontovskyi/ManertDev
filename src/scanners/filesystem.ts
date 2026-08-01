import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.map",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

const CODE_GLOBS = [
  "**/*.{js,jsx,ts,tsx,mjs,cjs}",
  "**/*.{py,go,rs,java,rb,php}",
  "**/*.{json,yml,yaml,toml,env,ini}",
  "**/*.env*",
  "**/*.{md,txt}",
  "**/Dockerfile*",
  "**/docker-compose*.{yml,yaml}",
  "**/vercel.json",
  "**/next.config.*",
  "**/nuxt.config.*",
  "**/vite.config.*",
  "**/prisma/schema.prisma",
];

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  lines: string[];
}

export async function collectSourceFiles(
  root: string,
  maxFiles = 400,
): Promise<SourceFile[]> {
  const absRoot = path.resolve(root);
  const entries = await fg(CODE_GLOBS, {
    cwd: absRoot,
    ignore: IGNORE,
    onlyFiles: true,
    absolute: true,
    dot: true,
    suppressErrors: true,
  });

  const limited = entries.slice(0, maxFiles);
  const files: SourceFile[] = [];

  for (const absolutePath of limited) {
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > 1_500_000) continue; // skip huge files
      const content = await fs.readFile(absolutePath, "utf8");
      // skip binary-ish
      if (content.includes("\u0000")) continue;
      files.push({
        absolutePath,
        relativePath: path.relative(absRoot, absolutePath).replace(/\\/g, "/"),
        content,
        lines: content.split(/\r?\n/),
      });
    } catch {
      // unreadable — skip
    }
  }

  return files;
}

export function snippetAround(
  lines: string[],
  lineIndex0: number,
  radius = 1,
): string {
  const start = Math.max(0, lineIndex0 - radius);
  const end = Math.min(lines.length - 1, lineIndex0 + radius);
  return lines.slice(start, end + 1).join("\n").slice(0, 500);
}

export function makeId(prefix: string, file: string, line: number): string {
  const safe = file.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  return `${prefix}_${safe}_${line}`;
}

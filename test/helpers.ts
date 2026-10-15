import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import type { CliIo } from '../src/commands.js';

const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

/** Writes a throwaway Next.js project from a map of path to contents, and returns its root. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'next-check-links-'));
  created.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

/** A page component that renders the given JSX. */
export const page = (jsx = '<main />', imports = "import Link from 'next/link';") =>
  `${imports}\nexport default function Page() {\n  return (${jsx});\n}\n`;

export interface CapturedIo extends CliIo {
  out: () => string;
  err: () => string;
}

export function captureIo(cwd: string): CapturedIo {
  let out = '';
  let err = '';
  return {
    cwd,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    out: () => out,
    err: () => err,
  };
}

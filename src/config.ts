import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CheckLinksError } from './errors.js';

/** Everything that can be set in `next-check-links.config.{json,mjs}` (all optional). */
export interface FileConfig {
  /** Globs of source files to read, relative to the root. Replaces the default. */
  include?: string[];
  /** Globs of source files to skip, added to the default list. */
  exclude?: string[];
  /** Path globs that are known to be fine, e.g. `/api/**` served by another app. */
  allow?: string[];
  /** Globs of files whose every string starting with `/` is a link, e.g. a route map. */
  routeFiles?: string[];
  /** Overrides the `basePath` read from `next.config`. */
  basePath?: string;
  /** Overrides the `pageExtensions` read from `next.config`. */
  pageExtensions?: string[];
  /** Set to false to ignore `next.config` entirely. */
  nextConfig?: boolean;
  /** JSX attributes and object keys read as links. Default `['href']`. */
  hrefNames?: string[];
}

export const CONFIG_FILES = ['next-check-links.config.json', 'next-check-links.config.mjs'];

const ARRAY_KEYS = ['include', 'exclude', 'allow', 'routeFiles', 'pageExtensions', 'hrefNames'] as const;

/** Checks the shape of a config object and returns it typed. Unknown keys are an error, to catch typos. */
export function validateConfig(value: unknown, where: string): FileConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CheckLinksError('CONFIG', `${where}: the config must be an object`);
  }
  const config = value as Record<string, unknown>;
  for (const [key, v] of Object.entries(config)) {
    if ((ARRAY_KEYS as readonly string[]).includes(key)) {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
        throw new CheckLinksError('CONFIG', `${where}: "${key}" must be an array of strings`);
      }
    } else if (key === 'basePath') {
      if (typeof v !== 'string') throw new CheckLinksError('CONFIG', `${where}: "basePath" must be a string`);
    } else if (key === 'nextConfig') {
      if (typeof v !== 'boolean') throw new CheckLinksError('CONFIG', `${where}: "nextConfig" must be true or false`);
    } else if (key !== '$schema') {
      throw new CheckLinksError('CONFIG', `${where}: unknown option "${key}"`);
    }
  }
  return config as FileConfig;
}

/**
 * Loads the config file: `file` when given (relative to `root`), otherwise the
 * first of `next-check-links.config.json` and `.mjs` found in `root`. Returns
 * an empty config when there is none.
 */
export async function loadConfig(root: string, file?: string): Promise<{ config: FileConfig; file?: string }> {
  let path: string | undefined;
  if (file) {
    path = resolve(root, file);
    if (!existsSync(path)) throw new CheckLinksError('CONFIG', `Config file not found: ${file}`);
  } else {
    path = CONFIG_FILES.map((name) => join(root, name)).find((p) => existsSync(p));
  }
  if (!path) return { config: {} };
  let value: unknown;
  try {
    if (path.endsWith('.json')) {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } else {
      const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
      value = mod.default;
    }
  } catch (error) {
    throw new CheckLinksError('CONFIG', `Could not read ${path}: ${(error as Error).message}`);
  }
  return { config: validateConfig(value, path), file: path };
}

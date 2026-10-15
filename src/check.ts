import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { FileConfig } from './config.js';
import { CheckLinksError } from './errors.js';
import { globMatcher } from './glob.js';
import { findNextConfig, readNextConfig } from './next-config.js';
import { appRoutes, formatRoute, matchRoute, pagesRoutes, publicRoutes, type PathSegment, type Route } from './routes.js';
import { collectLinks, type Link } from './source.js';
import { closestRoute } from './suggest.js';

/** Options for {@link checkLinks}: the config file's options plus the root. */
export interface CheckOptions extends FileConfig {
  /** The Next.js project directory. Default: `process.cwd()`. */
  root?: string;
}

/** A link that no route, file, redirect or rewrite serves. */
export interface BrokenLink extends Link {
  /** Why it is broken, in a sentence. */
  reason: string;
  /** The closest existing route, when one is close enough to be the likely intent. */
  suggestion?: string;
}

/** The outcome of a check. */
export interface CheckResult {
  /** True when no link is broken. */
  ok: boolean;
  root: string;
  /** The router directories found, relative to the root. */
  appDir?: string;
  pagesDir?: string;
  /** The `next.config` file read, relative to the root. */
  nextConfig?: string;
  basePath: string;
  pageExtensions: string[];
  routes: Route[];
  /** Every internal link found, broken or not. */
  links: Link[];
  broken: BrokenLink[];
  /** Links skipped because they match an `allow` pattern. */
  allowed: Link[];
  /** How many source files were read. */
  filesScanned: number;
  /** What could not be read statically, such as a computed redirect source. */
  warnings: string[];
}

export const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];
const SOURCE_EXTENSIONS = '{js,jsx,ts,tsx,mjs,cjs,mts,cts}';
export const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '.next/**',
  'out/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '**/*.d.ts',
  '**/*.{test,spec}.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.stories.*',
  'next.config.*',
  'next-check-links.config.*',
];
const ALWAYS_SKIPPED_DIRS = new Set(['node_modules', '.git', '.next']);

const toPosix = (p: string) => p.split(sep).join('/');
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

function walkSources(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    let stat;
    try {
      stat = statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!ALWAYS_SKIPPED_DIRS.has(name)) walkSources(root, p, out);
    } else {
      out.push(toPosix(relative(root, p)));
    }
  }
}

/** Where the routers live: `app/` and `pages/` at the root win over `src/`, as in Next.js. */
export function findRouterDirs(root: string): { appDir?: string; pagesDir?: string; base: string } {
  for (const base of ['', 'src']) {
    const app = join(root, base, 'app');
    const pages = join(root, base, 'pages');
    if (isDir(app) || isDir(pages)) {
      return { ...(isDir(app) ? { appDir: app } : {}), ...(isDir(pages) ? { pagesDir: pages } : {}), base };
    }
  }
  return { base: '' };
}

function normalizeBasePath(value: string): string {
  if (!value || value === '/') return '';
  if (!value.startsWith('/')) {
    throw new CheckLinksError('INVALID_OPTION', `basePath must start with "/": ${value}`);
  }
  return value.replace(/\/+$/, '');
}

/**
 * Builds the route table and checks every internal link in the source against it.
 *
 * Throws {@link CheckLinksError} when the check cannot run (no `app/` or
 * `pages/`, a bad option). Broken links are not an error: they come back in
 * `broken`, with `ok: false`.
 */
export function checkLinks(options: CheckOptions = {}): CheckResult {
  const root = resolve(options.root ?? process.cwd());
  if (!isDir(root)) throw new CheckLinksError('NO_ROOT', `Not a directory: ${root}`);
  const { appDir, pagesDir, base } = findRouterDirs(root);
  if (!appDir && !pagesDir) {
    throw new CheckLinksError('NO_ROUTER', `No app/ or pages/ directory in ${root} (or in its src/). Is --root a Next.js project?`);
  }

  const warnings: string[] = [];
  const configFile = options.nextConfig === false ? undefined : findNextConfig(root);
  const nextConfig = configFile ? readNextConfig(configFile) : undefined;
  if (nextConfig) warnings.push(...nextConfig.warnings);

  const basePath = normalizeBasePath(options.basePath ?? nextConfig?.basePath ?? '');
  const pageExtensions = options.pageExtensions ?? nextConfig?.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS;
  const locales = nextConfig?.locales ?? [];

  // The route table.
  const routes: Route[] = [];
  if (appDir) routes.push(...appRoutes(root, appDir, pageExtensions));
  if (pagesDir) routes.push(...pagesRoutes(root, pagesDir, pageExtensions));
  routes.push(...publicRoutes(root, join(root, 'public')));
  for (const entry of nextConfig?.entries ?? []) {
    routes.push({
      pattern: formatRoute(entry.segments),
      segments: entry.segments,
      source: entry.kind,
      file: `${toPosix(relative(root, nextConfig!.file!))}:${entry.line}`,
      ...(entry.absolute ? { absolute: true } : {}),
    });
  }
  const relativeRoutes = routes.filter((r) => !r.absolute);
  const absoluteRoutes = routes.filter((r) => r.absolute);

  // The source files.
  const include = options.include ?? [`${base ? `${base}/` : ''}**/*.${SOURCE_EXTENSIONS}`];
  const isIncluded = globMatcher(include);
  const isExcluded = globMatcher([...DEFAULT_EXCLUDE, ...(options.exclude ?? [])]);
  const isRouteFile = globMatcher(options.routeFiles ?? []);
  const all: string[] = [];
  walkSources(root, root, all);
  const files = all.filter((f) => isRouteFile(f) || (isIncluded(f) && !isExcluded(f)));

  const links: Link[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    links.push(...collectLinks(file, text, { allStrings: isRouteFile(file), ...(options.hrefNames ? { hrefNames: options.hrefNames } : {}) }));
  }

  // The check.
  const isAllowed = globMatcher(options.allow ?? []);
  const basePathSegments: PathSegment[] = basePath
    .split('/')
    .filter(Boolean)
    .map((value) => ({ kind: 'static', value }));
  const startsWithBasePath = (segments: readonly PathSegment[]) =>
    basePathSegments.length > 0 &&
    segments.length >= basePathSegments.length &&
    basePathSegments.every((b, i) => {
      const s = segments[i]!;
      return s.kind === 'static' && b.kind === 'static' && s.value === b.value;
    });
  const served = (segments: PathSegment[], table: readonly Route[]): boolean => {
    if (table.some((r) => matchRoute(r.segments, segments))) return true;
    // With i18n, `/fr/about` is `/about` in French.
    const first = segments[0];
    return !!first && first.kind === 'static' && locales.includes(first.value) && table.some((r) => matchRoute(r.segments, segments.slice(1)));
  };
  /** Next.js adds basePath to Link, the router and redirect(); a plain <a> gets nothing added. */
  const resolves = (link: Link): boolean => {
    const plainAnchor = link.kind === 'jsx-href' && link.element === 'a';
    if (plainAnchor && basePath) {
      if (served(link.segments, absoluteRoutes)) return true;
      return startsWithBasePath(link.segments) && served(link.segments.slice(basePathSegments.length), relativeRoutes);
    }
    return served(link.segments, relativeRoutes) || served([...basePathSegments, ...link.segments], absoluteRoutes);
  };

  const broken: BrokenLink[] = [];
  const allowed: Link[] = [];
  for (const link of links) {
    if (isAllowed(link.path)) {
      allowed.push(link);
      continue;
    }
    if (resolves(link)) continue;
    let reason = `no route serves ${link.path}`;
    let suggestion = closestRoute(link.segments, relativeRoutes);
    const plainAnchor = link.kind === 'jsx-href' && link.element === 'a';
    if (basePath && plainAnchor && !startsWithBasePath(link.segments) && served(link.segments, relativeRoutes)) {
      reason = `a plain <a> does not add basePath "${basePath}", so this leaves the app`;
      suggestion = basePath + link.path;
    } else if (basePath && !plainAnchor && startsWithBasePath(link.segments) && served(link.segments.slice(basePathSegments.length), relativeRoutes)) {
      reason = `starts with basePath "${basePath}", which Next.js adds itself, so this goes to ${basePath}${link.path}`;
      suggestion = link.path.slice(basePath.length) || '/';
    } else if (link.segments.some((s) => s.kind === 'param')) {
      reason = `no route serves ${link.path}: a \${…} segment needs a dynamic route such as [slug] to land on`;
    }
    broken.push({ ...link, reason, ...(suggestion ? { suggestion } : {}) });
  }

  return {
    ok: broken.length === 0,
    root,
    ...(appDir ? { appDir: toPosix(relative(root, appDir)) } : {}),
    ...(pagesDir ? { pagesDir: toPosix(relative(root, pagesDir)) } : {}),
    ...(configFile ? { nextConfig: toPosix(relative(root, configFile)) } : {}),
    basePath,
    pageExtensions,
    routes,
    links,
    broken,
    allowed,
    filesScanned: files.length,
    warnings,
  };
}

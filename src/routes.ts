import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** One segment of a route, as Next.js reads a folder or file name. */
export type RouteSegment =
  | { kind: 'static'; value: string }
  /** `[slug]`: exactly one segment. */
  | { kind: 'dynamic'; name: string }
  /** `[...slug]`: one or more segments. */
  | { kind: 'catchAll'; name: string }
  /** `[[...slug]]`: zero or more segments. */
  | { kind: 'optionalCatchAll'; name: string };

/** Where a route came from. */
export type RouteSource = 'page' | 'route' | 'metadata' | 'public' | 'redirect' | 'rewrite' | 'extra';

/** A URL the app answers, and the file or config entry that makes it so. */
export interface Route {
  /** The route written the Next.js way, e.g. `/work/[slug]` or `/docs/[[...path]]`. */
  pattern: string;
  segments: RouteSegment[];
  source: RouteSource;
  /** The file that defines it, relative to the root, with `/` separators. */
  file: string;
  /**
   * True for a `next.config` redirect or rewrite with `basePath: false`: its
   * source is a full path on the host, not a path under `basePath`.
   */
  absolute?: boolean;
}

/** One segment of a link's path: a literal, or one that holds a runtime value. */
export type PathSegment = { kind: 'static'; value: string } | { kind: 'param'; text: string };

/** Turns a route back into its display form. */
export function formatRoute(segments: readonly RouteSegment[]): string {
  if (segments.length === 0) return '/';
  return segments
    .map((s) => {
      switch (s.kind) {
        case 'static':
          return `/${s.value}`;
        case 'dynamic':
          return `/[${s.name}]`;
        case 'catchAll':
          return `/[...${s.name}]`;
        case 'optionalCatchAll':
          return `/[[...${s.name}]]`;
      }
    })
    .join('');
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parses one App or Pages Router folder or file name into a segment. */
export function parseFolderSegment(name: string): RouteSegment {
  let m = /^\[\[\.\.\.(.+)\]\]$/.exec(name);
  if (m) return { kind: 'optionalCatchAll', name: m[1]! };
  m = /^\[\.\.\.(.+)\]$/.exec(name);
  if (m) return { kind: 'catchAll', name: m[1]! };
  m = /^\[(.+)\]$/.exec(name);
  if (m) return { kind: 'dynamic', name: m[1]! };
  // `%5F` lets a URL segment start with an underscore without making the folder private.
  return { kind: 'static', value: decode(name) };
}

const INTERCEPTING = /^\((?:\.|\.\.|\.\.\.)\)/;
const isGroup = (name: string) => name.startsWith('(') && name.endsWith(')');
const isSlot = (name: string) => name.startsWith('@');

/**
 * Does `path` land on `route`? A static path segment matches a static route
 * segment of the same text, or any dynamic one. A segment that holds a runtime
 * value (`${slug}`) matches only a dynamic, catch-all or optional catch-all
 * segment: nothing proves which static page it would name.
 */
export function matchRoute(route: readonly RouteSegment[], path: readonly PathSegment[]): boolean {
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    let result: boolean;
    const r = route[i];
    if (!r) {
      result = j === path.length;
    } else if (r.kind === 'static') {
      const p = path[j];
      result = !!p && p.kind === 'static' && p.value === r.value && go(i + 1, j + 1);
    } else if (r.kind === 'dynamic') {
      result = j < path.length && go(i + 1, j + 1);
    } else {
      const min = r.kind === 'catchAll' ? 1 : 0;
      result = false;
      for (let n = min; j + n <= path.length && !result; n++) result = go(i + 1, j + n);
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const p = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

const toPosix = (p: string) => p.split(sep).join('/');

/** Splits `name.ext` against a list of possible extensions (longest first, so `dyn.ts` beats `ts`). */
function splitExtension(fileName: string, extensions: readonly string[]): { base: string; ext: string } | null {
  const sorted = [...extensions].sort((a, b) => b.length - a.length);
  for (const ext of sorted) {
    if (fileName.endsWith(`.${ext}`) && fileName.length > ext.length + 1) {
      return { base: fileName.slice(0, -(ext.length + 1)), ext };
    }
  }
  return null;
}

const METADATA_IMAGES: Record<string, readonly string[]> = {
  icon: ['ico', 'jpg', 'jpeg', 'png', 'svg'],
  'apple-icon': ['jpg', 'jpeg', 'png'],
  'opengraph-image': ['jpg', 'jpeg', 'png', 'gif'],
  'twitter-image': ['jpg', 'jpeg', 'png', 'gif'],
};

/**
 * The URLs one App Router file creates, given the URL segments of its folder.
 * Pages and route handlers, plus the metadata file conventions.
 */
function appFileRoutes(
  fileName: string,
  dirSegments: RouteSegment[],
  isRoot: boolean,
  pageExtensions: readonly string[],
  readText: () => string,
): Array<{ segments: RouteSegment[]; source: RouteSource }> {
  const out: Array<{ segments: RouteSegment[]; source: RouteSource }> = [];
  const code = splitExtension(fileName, pageExtensions);
  const at = (...extra: RouteSegment[]) => [...dirSegments, ...extra];
  const lit = (value: string): RouteSegment => ({ kind: 'static', value });

  if (code?.base === 'page') return [{ segments: at(), source: 'page' }];
  if (code?.base === 'route') return [{ segments: at(), source: 'route' }];

  // robots, manifest and favicon only count at the root of the app.
  if (isRoot) {
    if (fileName === 'robots.txt' || code?.base === 'robots') out.push({ segments: [lit('robots.txt')], source: 'metadata' });
    if (fileName === 'manifest.json') out.push({ segments: [lit('manifest.json')], source: 'metadata' });
    if (fileName === 'manifest.webmanifest' || code?.base === 'manifest') {
      out.push({ segments: [lit('manifest.webmanifest')], source: 'metadata' });
    }
    if (fileName === 'favicon.ico') out.push({ segments: [lit('favicon.ico')], source: 'metadata' });
  }

  if (fileName === 'sitemap.xml') out.push({ segments: at(lit('sitemap.xml')), source: 'metadata' });
  if (code?.base === 'sitemap') {
    out.push({ segments: at(lit('sitemap.xml')), source: 'metadata' });
    if (/\bgenerateSitemaps\b/.test(readText())) {
      out.push({ segments: at(lit('sitemap'), { kind: 'dynamic', name: 'id' }), source: 'metadata' });
    }
  }

  for (const [name, staticExts] of Object.entries(METADATA_IMAGES)) {
    const m = new RegExp(`^(${name}\\d?)\\.(.+)$`).exec(fileName);
    if (!m) continue;
    const [, stem, ext] = m as unknown as [string, string, string];
    if (staticExts.includes(ext)) {
      out.push({ segments: at(lit(`${stem}.${ext}`)), source: 'metadata' });
    } else if (code && code.base === stem) {
      out.push({ segments: at(lit(stem)), source: 'metadata' });
      if (/\bgenerateImageMetadata\b/.test(readText())) {
        out.push({ segments: at(lit(stem), { kind: 'dynamic', name: 'id' }), source: 'metadata' });
      }
    }
  }
  return out;
}

/**
 * Every URL an App Router directory serves.
 *
 * Route groups `(name)` and parallel slots `@name` add nothing to the URL;
 * private folders `_name` and everything under them are skipped, as Next.js
 * does; a path through an intercepting segment `(.)`, `(..)` or `(...)` is
 * skipped, because it only intercepts a route that exists elsewhere.
 */
export function appRoutes(root: string, appDir: string, pageExtensions: readonly string[]): Route[] {
  const routes: Route[] = [];
  for (const file of walkFiles(appDir)) {
    const parts = toPosix(relative(appDir, file)).split('/');
    const fileName = parts.pop()!;
    if (parts.some((p) => p.startsWith('_') || INTERCEPTING.test(p)) || fileName.startsWith('_')) continue;
    const dirSegments = parts.filter((p) => !isGroup(p) && !isSlot(p)).map(parseFolderSegment);
    const isRoot = parts.length === 0;
    let text: string | undefined;
    const readText = () => (text ??= readFileSync(file, 'utf8'));
    for (const r of appFileRoutes(fileName, dirSegments, isRoot, pageExtensions, readText)) {
      routes.push({ pattern: formatRoute(r.segments), segments: r.segments, source: r.source, file: toPosix(relative(root, file)) });
    }
  }
  return routes;
}

/**
 * Every URL a Pages Router directory serves: each page file is a route,
 * `index` names its folder, `pages/api/*` are API routes, and `_app`,
 * `_document` and `_error` at the top are not routes.
 */
export function pagesRoutes(root: string, pagesDir: string, pageExtensions: readonly string[]): Route[] {
  const routes: Route[] = [];
  for (const file of walkFiles(pagesDir)) {
    const parts = toPosix(relative(pagesDir, file)).split('/');
    const split = splitExtension(parts.pop()!, pageExtensions);
    if (!split) continue;
    if (parts.length === 0 && /^_(app|document|error)$/.test(split.base)) continue;
    if (split.base !== 'index') parts.push(split.base);
    const segments = parts.map(parseFolderSegment);
    const isApi = parts[0] === 'api';
    routes.push({ pattern: formatRoute(segments), segments, source: isApi ? 'route' : 'page', file: toPosix(relative(root, file)) });
  }
  return routes;
}

/** Every file in `public/`, which Next.js serves at the same path. */
export function publicRoutes(root: string, publicDir: string): Route[] {
  if (!existsSync(publicDir)) return [];
  return walkFiles(publicDir).map((file) => {
    const segments: RouteSegment[] = toPosix(relative(publicDir, file))
      .split('/')
      .map((value) => ({ kind: 'static', value }));
    return { pattern: formatRoute(segments), segments, source: 'public' as const, file: toPosix(relative(root, file)) };
  });
}

/**
 * Parses a `next.config` redirect or rewrite `source` (path-to-regexp syntax)
 * into route segments: `:name` is one segment, `:name*` zero or more, `:name+`
 * one or more, `:name?` zero or one; a segment holding a regex group, such as
 * `(.*)`, or a parameter with a pattern, such as `:id(\\d+)`, is treated as
 * matching anything there. That is looser than Next.js, never stricter.
 */
export function parseSourcePattern(source: string): RouteSegment[] {
  const clean = source.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return [];
  const out: RouteSegment[] = [];
  // Split on `/` outside parentheses, so `(.*)` and `:id(\\d+/\\d+)` stay whole.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of clean) {
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (c === '/' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  for (const part of parts) {
    const param = /^:(\w+)(\([^]*\))?([*+?])?$/.exec(part);
    const modifier = param?.[3] ?? (/^\([^]*\)([*+?])?$/.exec(part)?.[1] ?? undefined);
    const name = param?.[1] ?? 'path';
    if (param || part.startsWith('(')) {
      // A pattern such as `(.*)` can span several segments.
      const spans = /\.\*|\.\+/.test(part);
      if (modifier === '*' || modifier === '?' || spans) out.push({ kind: 'optionalCatchAll', name });
      else if (modifier === '+') out.push({ kind: 'catchAll', name });
      else out.push({ kind: 'dynamic', name });
    } else if (part.includes(':') || part.includes('(')) {
      // A parameter inside a segment, such as `v:version`: matches any one segment.
      out.push({ kind: 'dynamic', name });
    } else {
      out.push({ kind: 'static', value: decode(part) });
    }
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import { appRoutes, matchRoute, pagesRoutes, parseFolderSegment, parseSourcePattern, publicRoutes } from '../src/routes.js';
import { toPath } from '../src/source.js';
import { join } from 'node:path';
import { project } from './helpers.js';

const patterns = (routes: { pattern: string }[]) => routes.map((r) => r.pattern).sort();
const path = (p: string) => toPath([p])!.segments;
const T = ['tsx', 'ts', 'jsx', 'js'];

describe('app router', () => {
  it('reads pages, route handlers and every dynamic segment type', () => {
    const root = project({
      'app/page.tsx': '',
      'app/layout.tsx': '',
      'app/not-found.tsx': '',
      'app/loading.tsx': '',
      'app/about/page.jsx': '',
      'app/api/health/route.ts': '',
      'app/blog/[slug]/page.tsx': '',
      'app/docs/[...path]/page.tsx': '',
      'app/shop/[[...filters]]/page.tsx': '',
      'app/feed.xml/route.js': '',
    });
    expect(patterns(appRoutes(root, join(root, 'app'), T))).toEqual([
      '/',
      '/about',
      '/api/health',
      '/blog/[slug]',
      '/docs/[...path]',
      '/feed.xml',
      '/shop/[[...filters]]',
    ]);
  });

  it('drops route groups and parallel slots from the URL, skips private folders and intercepting routes', () => {
    const root = project({
      'app/(marketing)/pricing/page.tsx': '',
      'app/(shop)/(nested)/cart/page.tsx': '',
      'app/@modal/default.tsx': '',
      'app/@modal/login/page.tsx': '',
      'app/feed/@modal/(.)photo/[id]/page.tsx': '',
      'app/feed/(..)settings/page.tsx': '',
      'app/(...)terms/page.tsx': '',
      'app/feed/page.tsx': '',
      'app/_components/page.tsx': '',
      'app/settings/_lib/deep/page.tsx': '',
      'app/%5Fescaped/page.tsx': '',
    });
    expect(patterns(appRoutes(root, join(root, 'app'), T))).toEqual(['/_escaped', '/cart', '/feed', '/login', '/pricing']);
  });

  it('reads the metadata file conventions', () => {
    const root = project({
      'app/sitemap.ts': 'export default function sitemap() { return []; }',
      'app/robots.ts': '',
      'app/manifest.ts': '',
      'app/favicon.ico': '',
      'app/icon.png': '',
      'app/apple-icon.png': '',
      'app/opengraph-image.tsx': '',
      'app/twitter-image.png': '',
      'app/blog/[slug]/opengraph-image.tsx': 'export function generateImageMetadata() {}',
      'app/blog/[slug]/page.tsx': '',
      'app/products/sitemap.ts': 'export async function generateSitemaps() {}',
      'app/products/icon2.svg': '',
      'app/nested/robots.ts': '',
      'app/nested/favicon.ico': '',
      'app/globals.css': '',
    });
    expect(patterns(appRoutes(root, join(root, 'app'), T))).toEqual([
      '/apple-icon.png',
      '/blog/[slug]',
      '/blog/[slug]/opengraph-image',
      '/blog/[slug]/opengraph-image/[id]',
      '/favicon.ico',
      '/icon.png',
      '/manifest.webmanifest',
      '/opengraph-image',
      '/products/icon2.svg',
      '/products/sitemap.xml',
      '/products/sitemap/[id]',
      '/robots.txt',
      '/sitemap.xml',
      '/twitter-image.png',
    ]);
  });

  it('honors custom pageExtensions, longest extension first', () => {
    const root = project({ 'app/api/revalidate/route.dyn.ts': '', 'app/page.mdx': '', 'app/x/page.tsx': '' });
    expect(patterns(appRoutes(root, join(root, 'app'), ['dyn.ts', 'mdx']))).toEqual(['/', '/api/revalidate']);
  });
});

describe('pages router', () => {
  it('maps files to routes, index to its folder, and skips _app, _document and _error', () => {
    const root = project({
      'pages/index.tsx': '',
      'pages/_app.tsx': '',
      'pages/_document.tsx': '',
      'pages/_error.tsx': '',
      'pages/404.tsx': '',
      'pages/about.tsx': '',
      'pages/blog/index.js': '',
      'pages/blog/[slug].tsx': '',
      'pages/docs/[...path].tsx': '',
      'pages/api/users/[id].ts': '',
      'pages/styles.css': '',
    });
    const routes = pagesRoutes(root, join(root, 'pages'), T);
    expect(patterns(routes)).toEqual(['/', '/404', '/about', '/api/users/[id]', '/blog', '/blog/[slug]', '/docs/[...path]']);
    expect(routes.find((r) => r.pattern === '/api/users/[id]')?.source).toBe('route');
  });
});

describe('public files', () => {
  it('serves every file at its own path', () => {
    const root = project({ 'public/robots.txt': '', 'public/brand/logo.svg': '' });
    expect(patterns(publicRoutes(root, join(root, 'public')))).toEqual(['/brand/logo.svg', '/robots.txt']);
    expect(publicRoutes(root, join(root, 'missing'))).toEqual([]);
  });
});

describe('matchRoute', () => {
  const seg = (folders: string) => folders.split('/').filter(Boolean).map(parseFolderSegment);

  it('matches static, dynamic, catch-all and optional catch-all segments', () => {
    expect(matchRoute(seg(''), path('/'))).toBe(true);
    expect(matchRoute(seg('about'), path('/about'))).toBe(true);
    expect(matchRoute(seg('about'), path('/About'))).toBe(false);
    expect(matchRoute(seg('blog/[slug]'), path('/blog/hello'))).toBe(true);
    expect(matchRoute(seg('blog/[slug]'), path('/blog'))).toBe(false);
    expect(matchRoute(seg('blog/[slug]'), path('/blog/a/b'))).toBe(false);
    expect(matchRoute(seg('docs/[...p]'), path('/docs'))).toBe(false);
    expect(matchRoute(seg('docs/[...p]'), path('/docs/a/b/c'))).toBe(true);
    expect(matchRoute(seg('shop/[[...p]]'), path('/shop'))).toBe(true);
    expect(matchRoute(seg('shop/[[...p]]'), path('/shop/a/b'))).toBe(true);
    expect(matchRoute(seg('[locale]/about'), path('/fr/about'))).toBe(true);
  });

  it('lets a runtime segment land only on a dynamic segment', () => {
    const work = toPath(['/work/', { hole: 'slug' }])!.segments;
    expect(matchRoute(seg('work/[slug]'), work)).toBe(true);
    expect(matchRoute(seg('work/[...slug]'), work)).toBe(true);
    expect(matchRoute(seg('work/case-study'), work)).toBe(false);
    expect(matchRoute(seg('work'), work)).toBe(false);
  });
});

describe('parseSourcePattern', () => {
  it('reads path-to-regexp sources', () => {
    const fmt = (s: string) =>
      parseSourcePattern(s).map((x) => (x.kind === 'static' ? x.value : x.kind));
    expect(fmt('/old')).toEqual(['old']);
    expect(fmt('/')).toEqual([]);
    expect(fmt('/blog/:slug')).toEqual(['blog', 'dynamic']);
    expect(fmt('/docs/:path*')).toEqual(['docs', 'optionalCatchAll']);
    expect(fmt('/docs/:path+')).toEqual(['docs', 'catchAll']);
    expect(fmt('/post/:id(\\d{1,})')).toEqual(['post', 'dynamic']);
    expect(fmt('/legacy/(.*)')).toEqual(['legacy', 'optionalCatchAll']);
    expect(fmt('/:path((?!api/).*)')).toEqual(['optionalCatchAll']);
    expect(fmt('/v:version/docs')).toEqual(['dynamic', 'docs']);
  });
});

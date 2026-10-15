import { describe, expect, it } from 'vitest';
import { checkLinks } from '../src/check.js';
import { CheckLinksError } from '../src/errors.js';
import { page, project } from './helpers.js';

const broken = (root: string, options = {}) => checkLinks({ root, ...options }).broken.map((b) => b.raw);

describe('checkLinks', () => {
  it('passes when every link resolves, across every kind of route', () => {
    const root = project({
      'app/page.tsx': page(`<>
        <Link href="/about" /><Link href="/blog/hello" /><Link href="/docs/a/b" /><Link href="/shop" />
        <Link href="/api/health" /><a href="/sitemap.xml" /><a href="/robots.txt" /><a href="/brand/logo.svg" />
        <Link href="/pricing" /><Link href="/opengraph-image" />
      </>`),
      'app/about/page.tsx': page(),
      'app/blog/[slug]/page.tsx': page(),
      'app/docs/[...path]/page.tsx': page(),
      'app/shop/[[...filters]]/page.tsx': page(),
      'app/api/health/route.ts': 'export function GET() {}',
      'app/(marketing)/pricing/page.tsx': page(),
      'app/sitemap.ts': '',
      'app/robots.ts': '',
      'app/opengraph-image.tsx': '',
      'public/brand/logo.svg': '<svg/>',
    });
    const result = checkLinks({ root });
    expect(result.broken).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.links).toHaveLength(10);
    expect(result.appDir).toBe('app');
  });

  it('reports a broken link with file, line, column and the closest route', () => {
    const root = project({
      'app/page.tsx': page('<Link href="/abuot">About</Link>'),
      'app/about/page.tsx': page(),
      'app/contact/page.tsx': page(),
    });
    const result = checkLinks({ root });
    expect(result.ok).toBe(false);
    expect(result.broken).toEqual([
      expect.objectContaining({ file: 'app/page.tsx', line: 3, column: 17, raw: '/abuot', reason: 'no route serves /abuot', suggestion: '/about' }),
    ]);
  });

  it('gives no suggestion when nothing is close', () => {
    const root = project({ 'app/page.tsx': page('<Link href="/completely-unrelated-path" />'), 'app/about/page.tsx': page() });
    expect(checkLinks({ root }).broken[0]?.suggestion).toBeUndefined();
  });

  it('catches a template link to a dynamic route that does not exist, and passes once it does', () => {
    const files = {
      'lib/proof.ts': 'export const cards = (items: { slug: string }[]) => items.map(({ slug }) => ({ href: `/work/${slug}` }));',
      'app/page.tsx': page(),
      'app/work/page.tsx': page(),
      'app/work/case-study/page.tsx': page(),
    };
    const result = checkLinks({ root: project(files) });
    expect(result.broken).toEqual([
      expect.objectContaining({ file: 'lib/proof.ts', raw: '/work/${slug}', suggestion: '/work' }),
    ]);
    expect(result.broken[0]?.reason).toMatch(/needs a dynamic route/);
    expect(broken(project({ ...files, 'app/work/[slug]/page.tsx': page() }))).toEqual([]);
  });

  it('accepts links that a literal redirect or rewrite source serves', () => {
    const root = project({
      'app/page.tsx': page('<><Link href="/old-blog/post" /><Link href="/home" /><Link href="/proxy/a/b" /><Link href="/gone" /></>'),
      'next.config.mjs': `export default {
        async redirects() { return [{ source: '/old-blog/:slug', destination: '/', permanent: true }, { source: '/home', destination: '/', permanent: true }]; },
        async rewrites() { return [{ source: '/proxy/:path*', destination: 'https://api.example.com/:path*' }]; },
      };`,
    });
    const result = checkLinks({ root });
    expect(result.broken.map((b) => b.raw)).toEqual(['/gone']);
    expect(result.nextConfig).toBe('next.config.mjs');
    expect(result.routes.filter((r) => r.source === 'redirect' || r.source === 'rewrite').map((r) => r.file)).toEqual([
      'next.config.mjs:2',
      'next.config.mjs:2',
      'next.config.mjs:3',
    ]);
  });

  it('ignores next.config when asked', () => {
    const root = project({
      'app/page.tsx': page('<Link href="/home" />'),
      'next.config.js': `module.exports = { redirects: async () => [{ source: '/home', destination: '/', permanent: true }] };`,
    });
    expect(broken(root)).toEqual([]);
    expect(broken(root, { nextConfig: false })).toEqual(['/home']);
  });

  describe('basePath', () => {
    const files = (config = `module.exports = { basePath: '/docs' };`) => ({
      'next.config.js': config,
      'app/page.tsx': page(`<>
        <Link href="/guide" />
        <Link href="/docs/guide" />
        <a href="/guide">plain</a>
        <a href="/docs/guide">plain, prefixed</a>
      </>`),
      'app/guide/page.tsx': page(),
    });

    it('applies Next.js rules: Link adds basePath, a plain <a> does not', () => {
      const result = checkLinks({ root: project(files()) });
      expect(result.basePath).toBe('/docs');
      expect(result.broken.map((b) => [b.raw, b.element, b.suggestion])).toEqual([
        ['/docs/guide', 'Link', '/guide'],
        ['/guide', 'a', '/docs/guide'],
      ]);
      expect(result.broken[0]?.reason).toMatch(/which Next.js adds itself/);
      expect(result.broken[1]?.reason).toMatch(/does not add basePath/);
    });

    it('takes basePath from an option over next.config', () => {
      const result = checkLinks({ root: project(files(`module.exports = {};`)), basePath: '/docs/' });
      expect(result.basePath).toBe('/docs');
      expect(result.broken).toHaveLength(2);
      expect(() => checkLinks({ root: project(files()), basePath: 'docs' })).toThrow(/must start with/);
    });

    it('treats a basePath: false redirect source as a path on the host', () => {
      const root = project({
        'next.config.js': `module.exports = { basePath: '/docs', redirects: async () => [{ source: '/other-app', destination: 'https://x', basePath: false, permanent: false }] };`,
        'app/page.tsx': page('<><a href="/other-app" /><Link href="/other-app" /></>'),
      });
      expect(checkLinks({ root }).broken.map((b) => b.element)).toEqual(['Link']);
    });
  });

  it('accepts locale-prefixed links when next.config lists i18n locales', () => {
    const root = project({
      'next.config.js': `module.exports = { i18n: { locales: ['en', 'fr'], defaultLocale: 'en' } };`,
      'pages/index.tsx': page('<><Link href="/fr/about" /><Link href="/de/about" /></>'),
      'pages/about.tsx': page(),
    });
    expect(broken(root)).toEqual(['/de/about']);
  });

  it('honors allow patterns', () => {
    const root = project({ 'app/page.tsx': page('<><Link href="/api/v1/users" /><Link href="/status" /><Link href="/nope" /></>') });
    const result = checkLinks({ root, allow: ['/api/**', '/status'] });
    expect(result.broken.map((b) => b.raw)).toEqual(['/nope']);
    expect(result.allowed.map((l) => l.raw)).toEqual(['/api/v1/users', '/status']);
  });

  it('reads route files for every path string in them', () => {
    const root = project({
      'app/page.tsx': page(),
      'app/about/page.tsx': page(),
      'lib/site.ts': `export const ROUTES = { home: '/', about: '/about', team: '/team' };`,
    });
    expect(broken(root)).toEqual([]);
    expect(broken(root, { routeFiles: ['lib/site.ts'] })).toEqual(['/team']);
  });

  it('skips tests, stories, node_modules and build output by default, and honors include and exclude', () => {
    const root = project({
      'app/page.tsx': page(),
      'components/Nav.tsx': page('<Link href="/missing-nav" />'),
      'components/Nav.test.tsx': page('<Link href="/missing-test" />'),
      'components/Nav.stories.tsx': page('<Link href="/missing-story" />'),
      'node_modules/pkg/index.js': 'export const x = { href: "/missing-dep" };',
      '.next/server/page.js': 'export const x = { href: "/missing-build" };',
      'scripts/tool.mjs': 'export const x = { href: "/missing-script" };',
    });
    expect(broken(root).sort()).toEqual(['/missing-nav', '/missing-script']);
    expect(broken(root, { exclude: ['scripts/**'] })).toEqual(['/missing-nav']);
    expect(broken(root, { include: ['scripts/**'] })).toEqual(['/missing-script']);
  });

  it('reads src/ when the routers live there, and only src/ by default', () => {
    const root = project({
      'src/app/page.tsx': page('<Link href="/about" />'),
      'src/app/about/page.tsx': page(),
      'src/components/Footer.tsx': page('<Link href="/missing" />'),
      'tools/build.mjs': 'export const x = { href: "/not-the-site" };',
    });
    const result = checkLinks({ root });
    expect(result.appDir).toBe('src/app');
    expect(result.broken.map((b) => [b.file, b.raw])).toEqual([['src/components/Footer.tsx', '/missing']]);
  });

  it('prefers app/ at the root over src/app, as Next.js does, and reads both routers together', () => {
    const root = project({
      'app/page.tsx': page('<><Link href="/legacy" /><Link href="/from-src" /></>'),
      'pages/legacy.tsx': page(),
      'src/app/from-src/page.tsx': page(),
    });
    const result = checkLinks({ root });
    expect(result.pagesDir).toBe('pages');
    expect(result.broken.map((b) => b.raw)).toEqual(['/from-src']);
  });

  it('reads custom pageExtensions from next.config', () => {
    const root = project({
      'next.config.ts': `export default { pageExtensions: process.env.X ? ['tsx', 'ts'] : ['dyn.ts', 'tsx', 'ts'] };`,
      'app/page.tsx': page('<Link href="/api/revalidate" />'),
      'app/api/revalidate/route.dyn.ts': '',
    });
    expect(broken(root)).toEqual([]);
    expect(broken(root, { pageExtensions: ['tsx', 'ts'] })).toEqual(['/api/revalidate']);
  });

  it('throws when there is no router or no root', () => {
    expect(() => checkLinks({ root: project({ 'README.md': '' }) })).toThrow(CheckLinksError);
    try {
      checkLinks({ root: project({ 'README.md': '' }) });
    } catch (error) {
      expect((error as CheckLinksError).code).toBe('NO_ROUTER');
    }
    expect(() => checkLinks({ root: '/definitely/not/here' })).toThrow(/Not a directory/);
  });
});

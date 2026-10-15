import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findNextConfig, readNextConfig } from '../src/next-config.js';
import { project } from './helpers.js';

const read = (name: string, text: string) => {
  const root = project({ [name]: text });
  return readNextConfig(join(root, name));
};

describe('readNextConfig', () => {
  it('reads basePath, pageExtensions (both branches of a ternary) and i18n locales', () => {
    const info = read(
      'next.config.ts',
      `import type { NextConfig } from 'next';
       const prod = process.env.X === '1';
       const nextConfig: NextConfig = {
         basePath: '/docs',
         pageExtensions: prod ? ['tsx', 'ts'] : ['dyn.ts', 'tsx', 'ts'],
         i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
       };
       export default nextConfig;`,
    );
    expect(info.basePath).toBe('/docs');
    expect(info.pageExtensions).toEqual(['tsx', 'ts', 'dyn.ts']);
    expect(info.locales).toEqual(['en', 'fr']);
    expect(info.warnings).toEqual([]);
  });

  it('reads literal redirect and rewrite sources, in every shape', () => {
    const info = read(
      'next.config.mjs',
      `const legacy = [{ source: '/old-blog/:slug', destination: '/blog/:slug', permanent: true }];
       export default {
         async redirects() {
           return [...legacy, { source: '/home', destination: '/', permanent: true }, { source: '/out', destination: 'https://x.com', basePath: false, permanent: false }];
         },
         rewrites: async () => ({
           beforeFiles: [{ source: '/proxy/:path*', destination: 'https://api.example.com/:path*' }],
           fallback: [{ source: '/legacy/(.*)', destination: 'https://old.example.com/$1' }],
         }),
       };`,
    );
    expect(info.entries.map((e) => [e.kind, e.source, e.absolute])).toEqual([
      ['redirect', '/old-blog/:slug', false],
      ['redirect', '/home', false],
      ['redirect', '/out', true],
      ['rewrite', '/proxy/:path*', false],
      ['rewrite', '/legacy/(.*)', false],
    ]);
    expect(info.warnings).toEqual([]);
  });

  it('follows module.exports and a list returned by name', () => {
    const info = read(
      'next.config.js',
      `const list = [{ source: '/a', destination: '/b', permanent: true }];
       module.exports = { redirects: async () => list };`,
    );
    expect(info.entries.map((e) => e.source)).toEqual(['/a']);
  });

  it('warns about what it cannot read without running the config', () => {
    const info = read(
      'next.config.js',
      `module.exports = {
         basePath: process.env.BASE_PATH,
         pageExtensions: getExtensions(),
         async redirects() { return [...(await fetchRedirects()), { source: \`/\${prefix}/x\`, destination: '/' }]; },
         rewrites: loadRewrites,
       };`,
    );
    expect(info.basePath).toBeUndefined();
    expect(info.entries).toEqual([]);
    expect(info.warnings).toHaveLength(5);
    expect(info.warnings.join('\n')).toMatch(/basePath is not a literal/);
    expect(info.warnings.join('\n')).toMatch(/pageExtensions is not a literal/);
    expect(info.warnings.join('\n')).toMatch(/spread inside redirects/);
    expect(info.warnings.join('\n')).toMatch(/redirect source is not a literal/);
    expect(info.warnings.join('\n')).toMatch(/rewrites is not written inline/);
  });

  it('finds next.config in the order Next.js does', () => {
    const root = project({ 'next.config.js': '', 'next.config.mjs': '' });
    expect(findNextConfig(root)).toBe(join(root, 'next.config.mjs'));
    expect(findNextConfig(project({ 'app/page.tsx': '' }))).toBeUndefined();
  });
});

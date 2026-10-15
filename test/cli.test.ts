import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT, main } from '../src/commands.js';
import { VERSION } from '../src/index.js';
import { captureIo, page, project } from './helpers.js';

const goodSite = () =>
  project({
    'app/page.tsx': page('<Link href="/about" />'),
    'app/about/page.tsx': page(),
  });
const badSite = () =>
  project({
    'app/page.tsx': page('<><Link href="/abuot" /><Link href="/api/x" /></>'),
    'app/about/page.tsx': page(),
  });

describe('general', () => {
  it('prints help and the version from package.json', async () => {
    const help = captureIo(process.cwd());
    expect(await main(['--help'], help)).toBe(EXIT.OK);
    expect(help.out()).toMatch(/Usage:/);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const version = captureIo(process.cwd());
    expect(await main(['-v'], version)).toBe(EXIT.OK);
    expect(version.out().trim()).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it('exits 2 on usage errors', async () => {
    const unknown = captureIo(process.cwd());
    expect(await main(['--nope'], unknown)).toBe(EXIT.USAGE);
    expect(unknown.err()).toMatch(/Unknown option/);
    const positional = captureIo(process.cwd());
    expect(await main(['app'], positional)).toBe(EXIT.USAGE);
    const format = captureIo(goodSite());
    expect(await main(['--format', 'xml'], format)).toBe(EXIT.USAGE);
    expect(format.err()).toMatch(/Unknown format "xml"/);
    expect(await main(['--page-extensions', ','], captureIo(goodSite()))).toBe(EXIT.USAGE);
  });

  it('exits 2 when the root is not a Next.js project', async () => {
    const io = captureIo(project({ 'README.md': '' }));
    expect(await main([], io)).toBe(EXIT.USAGE);
    expect(io.err()).toMatch(/No app\/ or pages\/ directory/);
  });
});

describe('checking', () => {
  it('exits 0 and says OK when every link resolves', async () => {
    const io = captureIo(goodSite());
    expect(await main([], io)).toBe(EXIT.OK);
    expect(io.out()).toMatch(/^next-check-links: OK\. 1 internal links in 2 files, 2 routes; every link resolves\./);
  });

  it('exits 1 and lists each broken link with its location and suggestion', async () => {
    const root = badSite();
    const io = captureIo('/');
    expect(await main(['--root', root], io)).toBe(EXIT.BROKEN);
    expect(io.err()).toContain('next-check-links: 2 broken link(s).');
    expect(io.err()).toContain('app/page.tsx:3:19  /abuot\n  no route serves /abuot\n  closest route: /about\n');
  });

  it('takes --allow, repeatable', async () => {
    expect(await main(['--allow', '/api/**', '--allow', '/abuot'], captureIo(badSite()))).toBe(EXIT.OK);
  });

  it('writes json', async () => {
    const io = captureIo(badSite());
    expect(await main(['--format', 'json'], io)).toBe(EXIT.BROKEN);
    const report = JSON.parse(io.out()) as { ok: boolean; broken: { raw: string; suggestion?: string; segments?: unknown }[]; routes: unknown[] };
    expect(report.ok).toBe(false);
    expect(report.broken.map((b) => b.raw)).toEqual(['/abuot', '/api/x']);
    expect(report.broken[0]?.suggestion).toBe('/about');
    expect(report.broken[0]?.segments).toBeUndefined();
    expect(report.routes).toHaveLength(2);
  });

  it('writes GitHub annotations, escaped', async () => {
    const io = captureIo(badSite());
    expect(await main(['--format', 'github'], io)).toBe(EXIT.BROKEN);
    expect(io.out()).toContain(
      '::error file=app/page.tsx,line=3,col=19,title=Broken internal link::/abuot: no route serves /abuot%0Aclosest route: /about\n',
    );
  });

  it('prints next.config warnings on stderr', async () => {
    const root = project({
      'app/page.tsx': page(),
      'next.config.js': 'module.exports = { basePath: process.env.BASE };',
    });
    const io = captureIo(root);
    expect(await main([], io)).toBe(EXIT.OK);
    expect(io.err()).toMatch(/warning: next\.config\.js:1: basePath is not a literal string/);
    const gh = captureIo(root);
    await main(['--format', 'github'], gh);
    expect(gh.out()).toMatch(/^::warning title=next-check-links::next.config.js:1: basePath/);
  });

  it('passes --base-path, --page-extensions, --no-next-config, --include, --exclude and --route-file through', async () => {
    const root = project({
      'next.config.js': `module.exports = { redirects: async () => [{ source: '/home', destination: '/', permanent: true }] };`,
      'app/page.mdx': '',
      'app/home-link.tsx': page('<Link href="/home" />'),
      'lib/routes.ts': `export const R = ['/team'];`,
    });
    expect(await main(['--page-extensions', 'mdx'], captureIo(root))).toBe(EXIT.OK);
    expect(await main(['--page-extensions', '.mdx,tsx', '--no-next-config'], captureIo(root))).toBe(EXIT.BROKEN);
    expect(await main(['--page-extensions', 'mdx', '--route-file', 'lib/routes.ts'], captureIo(root))).toBe(EXIT.BROKEN);
    expect(await main(['--page-extensions', 'mdx', '--no-next-config', '--exclude', 'app/home-link.tsx'], captureIo(root))).toBe(EXIT.OK);
    expect(await main(['--page-extensions', 'mdx', '--no-next-config', '--include', 'lib/**'], captureIo(root))).toBe(EXIT.OK);
    const based = captureIo(root);
    expect(await main(['--page-extensions', 'mdx', '--base-path', 'x'], based)).toBe(EXIT.USAGE);
    expect(based.err()).toMatch(/basePath must start with "\/"/);
  });
});

describe('config file', () => {
  it('reads next-check-links.config.json, and CLI lists add to it', async () => {
    const root = badSite();
    const withConfig = project({
      'app/page.tsx': page('<><Link href="/abuot" /><Link href="/api/x" /></>'),
      'app/about/page.tsx': page(),
      'next-check-links.config.json': JSON.stringify({ allow: ['/api/**'] }),
    });
    expect(await main([], captureIo(root))).toBe(EXIT.BROKEN);
    const io = captureIo(withConfig);
    expect(await main([], io)).toBe(EXIT.BROKEN);
    expect(io.err()).toContain('1 broken link(s)');
    expect(await main(['--allow', '/abuot'], captureIo(withConfig))).toBe(EXIT.OK);
  });

  it('reads next-check-links.config.mjs, and --config picks a file', async () => {
    const root = project({
      'app/page.tsx': page('<Link href="/team" />'),
      'next-check-links.config.mjs': `export default { allow: ['/team'] };`,
      'configs/strict.json': JSON.stringify({}),
    });
    expect(await main([], captureIo(root))).toBe(EXIT.OK);
    expect(await main(['--config', 'configs/strict.json'], captureIo(root))).toBe(EXIT.BROKEN);
  });

  it('exits 2 for a missing, unreadable or invalid config', async () => {
    const missing = captureIo(goodSite());
    expect(await main(['--config', 'nope.json'], missing)).toBe(EXIT.USAGE);
    expect(missing.err()).toMatch(/Config file not found/);
    const cases: Array<[string, RegExp]> = [
      ['{ not json', /Could not read/],
      ['[]', /must be an object/],
      ['{"allow": "/x"}', /"allow" must be an array of strings/],
      ['{"alow": ["/x"]}', /unknown option "alow"/],
      ['{"basePath": 1}', /"basePath" must be a string/],
      ['{"nextConfig": "no"}', /"nextConfig" must be true or false/],
    ];
    for (const [text, message] of cases) {
      const io = captureIo(project({ 'app/page.tsx': page(), 'next-check-links.config.json': text }));
      expect(await main([], io)).toBe(EXIT.USAGE);
      expect(io.err()).toMatch(message);
    }
  });
});

describe('examples/demo', () => {
  it('prints the report shown in the README', async () => {
    const io = captureIo(fileURLToPath(new URL('../examples/demo', import.meta.url)));
    expect(await main([], io)).toBe(EXIT.BROKEN);
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const shown = /```\n(next-check-links: 2 broken[^]*?)```/.exec(readme)?.[1];
    expect(io.err()).toBe(shown);
  });
});

import { describe, expect, it } from 'vitest';
import { collectLinks, toPath } from '../src/source.js';

const raws = (text: string, file = 'x.tsx', allStrings = false) => collectLinks(file, text, { allStrings }).map((l) => l.raw);
const paths = (text: string, file = 'x.tsx') => collectLinks(file, text).map((l) => l.path);

describe('JSX href', () => {
  it('reads string and expression hrefs on any element, with line and column', () => {
    const text = `export const A = () => (\n  <>\n    <Link href="/about">About</Link>\n    <a href={'/contact'}>Contact</a>\n    <Card href={"/work"} />\n  </>\n);`;
    const links = collectLinks('app/page.tsx', text);
    expect(links.map((l) => [l.raw, l.line, l.column, l.element, l.kind])).toEqual([
      ['/about', 3, 11, 'Link', 'jsx-href'],
      ['/contact', 4, 8, 'a', 'jsx-href'],
      ['/work', 5, 11, 'Card', 'jsx-href'],
    ]);
  });

  it('reduces a template literal to segments, a ${} segment becoming a runtime value', () => {
    const [link] = collectLinks('x.tsx', 'const A = ({ slug }) => <Link href={`/work/${slug}`} />;');
    expect(link?.raw).toBe('/work/${slug}');
    expect(link?.segments).toEqual([
      { kind: 'static', value: 'work' },
      { kind: 'param', text: '${slug}' },
    ]);
    expect(paths('const A = ({ s }) => <Link href={`/blog/${s}.json`} />;')).toEqual(['/blog/${s}.json']);
  });

  it('inlines const strings declared in the same file, in templates too', () => {
    const text = `const BASE = '/guides';\nconst HOME = '/';\nconst href = \`\${BASE}/intro\`;\nexport const A = () => <><Link href={href} /><a href={HOME} /></>;`;
    expect(raws(text)).toEqual(['/guides/intro', '/']);
  });

  it('follows ternaries, ??, ||, && and +', () => {
    const text = `const A = ({ on, x, slug }) => <>
      <Link href={on ? '/on' : '/off'} />
      <Link href={x ?? '/fallback'} />
      <Link href={x || '/or'} />
      <Link href={on && '/and'} />
      <Link href={'/tags/' + slug} />
    </>;`;
    expect(raws(text)).toEqual(['/on', '/off', '/fallback', '/or', '/and', '/tags/${slug}']);
  });

  it('reads { pathname } objects and as / satisfies casts', () => {
    const text = `const A = () => <>
      <Link href={{ pathname: '/search', query: { q: 'x' } }} />
      <Link href={'/typed' as Route} />
    </>;`;
    expect(raws(text)).toEqual(['/search', '/typed']);
  });

  it('strips the query and the hash, and the trailing slash', () => {
    expect(paths('const A = ({ q }) => <><Link href="/search?q=1#top" /><Link href={`/s?q=${q}`} /><Link href="/docs/" /><Link href="/#how" /></>;')).toEqual([
      '/search',
      '/s',
      '/docs',
      '/',
    ]);
  });

  it('ignores external URLs, mailto:, tel:, hashes, relative and protocol-relative links, and wholly runtime paths', () => {
    const text = `const A = ({ u, a, b }) => <>
      <a href="https://example.com/x" /><a href="mailto:hi@example.com" /><a href="tel:+100" />
      <a href="#top" /><a href="relative/path" /><a href="//cdn.example.com/x" /><a href="?page=2" />
      <Link href={u} /><Link href={\`/\${a}/\${b}\`} /><Link href={\`\${a}/x\`} />
    </>;`;
    expect(raws(text)).toEqual([]);
  });

  it('parses JSX in .js files', () => {
    expect(raws('export default () => <Link href="/js">x</Link>;', 'components/Nav.js')).toEqual(['/js']);
  });
});

describe('object href', () => {
  it('reads href properties anywhere, including string keys', () => {
    const text = `export const NAV = [{ label: 'Work', href: '/work' }, { 'href': '/about' }];\nexport const cards = (s: string) => ({ href: \`/work/\${s}\` });`;
    const links = collectLinks('lib/nav.ts', text);
    expect(links.map((l) => [l.raw, l.kind])).toEqual([
      ['/work', 'object-href'],
      ['/about', 'object-href'],
      ['/work/${s}', 'object-href'],
    ]);
  });

  it('reads other attribute and key names when configured', () => {
    const text = `const items = [{ url: '/a' }, { href: '/b' }];\nconst X = () => <Item to="/c" />;`;
    expect(collectLinks('x.tsx', text, { hrefNames: ['url', 'to'] }).map((l) => l.raw)).toEqual(['/a', '/c']);
  });
});

describe('router and redirect calls', () => {
  it('reads push, replace and prefetch on a useRouter() result', () => {
    const text = `import { useRouter } from 'next/navigation';
      export function A({ id }) {
        const nav = useRouter();
        const { push: go, replace } = useRouter();
        nav.push('/one'); nav.replace(\`/two/\${id}\`); nav.prefetch('/three');
        go('/four'); replace({ pathname: '/five' });
        useRouter().push('/six');
        nav.back();
      }`;
    const links = collectLinks('x.tsx', text);
    expect(links.map((l) => l.raw)).toEqual(['/one', '/two/${id}', '/three', '/four', '/five', '/six']);
    expect(new Set(links.map((l) => l.kind))).toEqual(new Set(['router']));
  });

  it('reads a variable named router, but not array.push', () => {
    expect(raws(`import Router from 'next/router';\nRouter.push('/a');\nconst paths = [];\npaths.push('/not-a-link');`)).toEqual(['/a']);
  });

  it('reads redirect and permanentRedirect imported from next/navigation, under any local name', () => {
    const text = `import { redirect, permanentRedirect as moved } from 'next/navigation';
      export default function P() { if (x) redirect('/login'); moved('/new-home'); }`;
    const links = collectLinks('app/page.tsx', text);
    expect(links.map((l) => [l.raw, l.kind])).toEqual([
      ['/login', 'redirect'],
      ['/new-home', 'redirect'],
    ]);
    expect(raws(`import { redirect } from './my-helpers';\nredirect('/elsewhere');`)).toEqual([]);
  });

  it('reads NextResponse.redirect and rewrite with new URL(path, base)', () => {
    const text = `import { NextResponse } from 'next/server';
      export function middleware(req) {
        if (!ok) return NextResponse.redirect(new URL('/sign-in', req.url));
        return NextResponse.rewrite(new URL('/maintenance', req.url));
      }`;
    expect(raws(text, 'middleware.ts')).toEqual(['/sign-in', '/maintenance']);
  });
});

describe('route files (allStrings)', () => {
  it('treats every string starting with / as a link, but not module names, sentences or type literals', () => {
    const text = `import x from '/abs/module';
      export * from '/abs/other';
      type P = '/typed-only';
      export const ROUTES = { home: '/', about: '/about', post: (s: string) => \`/blog/\${s}\` };
      const note = '/ this is a sentence';
      const nav = [{ href: '/once' }];`;
    const links = collectLinks('lib/routes.ts', text, { allStrings: true });
    expect(links.map((l) => [l.raw, l.kind])).toEqual([
      ['/', 'constant'],
      ['/about', 'constant'],
      ['/blog/${s}', 'constant'],
      ['/once', 'object-href'],
    ]);
  });
});

describe('toPath', () => {
  it('rejects what is not an internal path', () => {
    expect(toPath(['about'])).toBeNull();
    expect(toPath([{ hole: 'x' }, '/about'])).toBeNull();
    expect(toPath(['//cdn'])).toBeNull();
    expect(toPath(['/', { hole: 'x' }])).toBeNull();
    expect(toPath(['/'])?.path).toBe('/');
    expect(toPath(['/caf%C3%A9'])?.segments).toEqual([{ kind: 'static', value: 'café' }]);
  });
});

# @bydtech/next-check-links

Fail the build when a Next.js app links to one of its own routes that does not exist, read from the source, not the built pages.

[![npm version](https://img.shields.io/npm/v/@bydtech/next-check-links.svg)](https://www.npmjs.com/package/@bydtech/next-check-links)
[![CI](https://github.com/BYDTechSolutions/next-check-links/actions/workflows/ci.yml/badge.svg)](https://github.com/BYDTechSolutions/next-check-links/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why it exists

A crawler or a check of the built HTML only sees links that some page has already rendered. The dangerous broken link is the one the code will emit later: a card that builds `` `/work/${slug}` `` before any `/work/[slug]` route exists renders nothing while the list is empty, then turns every card into a 404 the day the first item is published. This tool reads the source, builds the route table from `app/`, `pages/`, `public/` and `next.config`, and fails when any internal link has nowhere to land.

## Install

```sh
npm install --save-dev @bydtech/next-check-links
```

Node.js 20 or later. One runtime dependency, the TypeScript parser (see [How it works](#how-it-works-and-its-limits)).

## Quick start

From the root of a Next.js project:

```sh
npx next-check-links
```

On the small project in [`examples/demo`](examples/demo), where a "Contact" link has a typo and the work cards link to a page that does not exist yet:

```
next-check-links: 2 broken link(s). 5 internal links in 5 files, 4 routes.

src/app/page.tsx:8:13  /contcat
  no route serves /contcat
  closest route: /contact

src/lib/work.ts:5:55  /work/${slug}
  no route serves /work/${slug}: a ${…} segment needs a dynamic route such as [slug] to land on
  closest route: /work

Add the route, fix the link, or list a known-good path with --allow.
```

Add it to `package.json` so it runs with your build or in CI:

```json
{
  "scripts": {
    "check:links": "next-check-links",
    "build": "next-check-links && next build"
  }
}
```

In GitHub Actions, `--format github` puts each broken link as an annotation on its line in the pull request:

```yaml
- run: npx next-check-links --format github
```

## CLI reference

```
next-check-links [options]
```

| Option | What it does |
|---|---|
| `--root <dir>` | The Next.js project. Default: the current directory. |
| `--config <file>` | Config file. Default: `next-check-links.config.json` or `.mjs` in the root, if present. |
| `--include <glob>` | Source files to read. Repeatable; replaces the default. |
| `--exclude <glob>` | Source files to skip. Repeatable; added to the default list. |
| `--allow <glob>` | A path known to be fine, such as `/api/**` served by another app. Repeatable. |
| `--route-file <glob>` | A file in which every string starting with `/` is a link, such as a route map. Repeatable. |
| `--base-path <path>` | Overrides `basePath` from `next.config`. |
| `--page-extensions <list>` | Overrides `pageExtensions`, comma-separated, such as `tsx,ts,mdx`. |
| `--no-next-config` | Do not read `next.config`. |
| `--format <name>` | `text` (default), `json` or `github`. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show the version. |

With `--format text`, an all-clear goes to stdout and a failure to stderr; `json` and `github` always write to stdout. Warnings about `next.config` values that could not be read (see below) go to stderr, or become `::warning` lines with `github`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Every internal link resolves. |
| `1` | At least one link points at a route nothing serves. |
| `2` | Usage or configuration error: unknown option, no `app/` or `pages/` under the root, an invalid config file. |

## API reference

```ts
import { checkLinks, formatReport } from '@bydtech/next-check-links';

const result = checkLinks({ root: '.', allow: ['/api/**'] });
if (!result.ok) {
  process.stderr.write(formatReport(result, 'text'));
  process.exitCode = 1;
}
for (const b of result.broken) console.log(b.file, b.line, b.raw, b.suggestion);
```

| Export | What it does |
|---|---|
| `checkLinks(options?)` | Builds the route table, reads the source, and returns `{ ok, broken, links, allowed, routes, warnings, basePath, pageExtensions, appDir?, pagesDir?, nextConfig?, filesScanned, root }`. Synchronous. Takes every option in the table below plus `root`. Throws `CheckLinksError` when the check cannot run; broken links are not an error. |
| `loadConfig(root, file?)` | Reads and validates the config file. Async, since a `.mjs` config is imported. Returns `{ config, file? }`. |
| `formatReport(result, format)` | The report as the CLI prints it; also `formatText`, `formatJson`, `formatGithub`. |
| `appRoutes(root, appDir, pageExtensions)` | The routes an App Router directory serves. |
| `pagesRoutes(root, pagesDir, pageExtensions)` | The routes a Pages Router directory serves. |
| `publicRoutes(root, publicDir)` | One route per file in `public/`. |
| `readNextConfig(file)` | What can be read from `next.config` without running it: `{ basePath?, pageExtensions?, locales?, entries, warnings }`. |
| `collectLinks(file, text, options?)` | The internal links in one source file. Options: `allStrings`, `hrefNames`. |
| `matchRoute(routeSegments, pathSegments)` | Whether a path lands on a route. |
| `closestRoute(pathSegments, routes)` | The suggestion used in reports, or `undefined`. |
| `parseSourcePattern(source)` | A redirect or rewrite `source` as route segments. |

Each `BrokenLink` has `file`, `line`, `column`, `raw` (as written, with `${…}` kept), `path` (query, hash and trailing slash removed), `kind` (`jsx-href`, `object-href`, `router`, `redirect`, `constant`), `element` for JSX, `reason`, and `suggestion` when a route is close enough. `CheckLinksError` has a `code`: `NO_ROUTER`, `NO_ROOT`, `CONFIG` or `INVALID_OPTION`. All types are exported.

## Configuration

Options go in `next-check-links.config.json` or `next-check-links.config.mjs` (default export) at the project root, or in the `checkLinks()` call. On the command line, `--exclude`, `--allow` and `--route-file` add to the file's lists; `--include` and the rest replace the file's value.

```json
{
  "allow": ["/api/auth/**", "/status"],
  "routeFiles": ["src/lib/routes.ts"],
  "exclude": ["src/legacy/**"]
}
```

| Option | Default | Meaning |
|---|---|---|
| `include` | `src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` when the routers are under `src/`, otherwise `**/*.{…}` | Source files to read, relative to the root. |
| `exclude` | `node_modules`, `.next/`, `out/`, `dist/`, `build/`, `coverage/`, `*.d.ts`, `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `*.stories.*`, `next.config.*`, this tool's config | Added to the defaults, never replacing them. |
| `allow` | `[]` | Path globs that pass without a route. Matched against the link's path, where a runtime segment is written `${…}` as in the source: `/work/*` allows `` `/work/${slug}` ``. |
| `routeFiles` | `[]` | Files in which every string starting with `/` is checked, for route maps like `export const ROUTES = { about: '/about' }`. Read even when `include` would skip them. |
| `basePath` | from `next.config`, else none | The app's `basePath`. |
| `pageExtensions` | from `next.config`, else `tsx`, `ts`, `jsx`, `js` | Which files are pages and route handlers. |
| `nextConfig` | `true` | `false` ignores `next.config` entirely. |
| `hrefNames` | `["href"]` | JSX attributes and object keys read as links. Add `"to"` or `"url"` if your components use those. |

Globs: `**` crosses folders, `*` and `?` stay within one, `{a,b}` is a choice.

## How it works, and its limits

**The route table.** A route is what Next.js would serve:

- App Router (`app/` or `src/app/`): every folder with a `page` or `route` file, with `[slug]`, `[...slug]` and `[[...slug]]`. Route groups `(name)` and parallel slots `@name` add nothing to the URL. Private folders `_name` are skipped with everything under them, and `%5Fname` becomes `_name`. A path through an intercepting segment, `(.)`, `(..)` or `(...)`, adds no route, since it only intercepts one that exists elsewhere. `layout`, `loading`, `not-found`, `default` and the rest are not routes.
- Metadata files: `sitemap.(xml|ts|js)` as `sitemap.xml` (and `sitemap/[id]` when the file mentions `generateSitemaps`), `robots` as `/robots.txt`, `manifest` as `/manifest.webmanifest` or `/manifest.json`, `favicon.ico`, and `icon`, `apple-icon`, `opengraph-image` and `twitter-image`: an image file at its own name, a code file at its name without extension (plus `/[id]` when it mentions `generateImageMetadata`). In a route group or slot, Next.js adds a hash to a metadata image's URL; this tool registers the name without it.
- Pages Router (`pages/` or `src/pages/`): every page file, `index` naming its folder, `pages/api/*` as API routes; `_app`, `_document` and `_error` are not routes. Both routers can live side by side. As in Next.js, `app/` and `pages/` at the root win over `src/`.
- `public/`: every file, at its own path.
- `next.config`: the `source` of each redirect and rewrite (`/old/:slug`, `/docs/:path*`, `/(.*)`), and `basePath`, `pageExtensions` and `i18n.locales`.

**Reading `next.config` without running it.** Running the config would execute your code and need your dependencies; reading it sees only what is written as a literal. A source built from a variable, a list fetched at build time, or `basePath: process.env.BASE_PATH` cannot be read: each one is reported as a warning, and you can pass `--base-path` or `--allow`. A list held in a `const` in the same file is followed; a ternary between two `pageExtensions` arrays counts both. `has` and `missing` conditions are ignored (the source is taken as always matching), and sources are read more loosely than Next.js does, never more strictly. Redirects done in middleware are not read: allow those paths.

**Finding links.** Each file is parsed with the TypeScript compiler's parser, so JSX, TypeScript, comments and strings are told apart the way the compiler does it, with no regular expressions over code. Read as links:

- JSX `href` on any element: `<Link href="/x">`, `<a href={'/x'}>`, `` <Card href={`/work/${slug}`}> ``.
- `href` properties in object literals, such as a nav array or a card builder.
- `push`, `replace` and `prefetch` on a router from `useRouter()`, or on a variable named `router` or `Router`.
- `redirect()` and `permanentRedirect()` imported from `next/navigation`, and `NextResponse.redirect()` and `.rewrite()` with a string or `new URL(path, base)`.
- `{ pathname: '/x' }` objects in any of those places.
- Every string starting with `/` in a configured route file.

A value is followed through ternaries (both branches), `??`, `||`, `&&`, `+`, template literals, `as` and `satisfies`, and `const` strings declared once in the same file. The query, hash and trailing slash are removed. External URLs, `mailto:`, `tel:`, `#hash`, `?query`, relative and protocol-relative links are skipped.

**Runtime values.** A `${…}` in a template stands for one segment that only runtime knows. It lands on a dynamic, catch-all or optional catch-all segment, never on a static one, because nothing proves which static page it would name. A link that is nothing but runtime values (`` `/${a}/${b}` ``) is skipped. `generateStaticParams` is not consulted: `/blog/anything` passes when `/blog/[slug]` exists.

**basePath.** `Link`, the router and `redirect()` add `basePath` themselves, so their links are checked as written and a link that already starts with `basePath` is reported (it would go to `/docs/docs/...`). A plain `<a href>` gets nothing added, so it must include `basePath`. `NextResponse.redirect(new URL(...))` is treated like `Link`.

**What it cannot see.** An `href` whose value comes from props, a CMS, a JSON file or a constant imported from another file is invisible unless the object literal or the string sits in a scanned file (use `routeFiles` for a route map). MDX and Markdown files are not read. Locale prefixes are understood only from a literal `i18n.locales`. Matching is case-sensitive, as Next.js routes are.

**Why TypeScript is a dependency.** It is the honest way to read TSX: the same parser Next.js projects compile with. It is a regular dependency (`^5.0.0 || ^6.0.0`) rather than a peer, so a JavaScript-only project needs nothing extra, and a project on TypeScript 7, whose package no longer ships the JavaScript compiler API, is not forced into a version conflict. When your project already has a compatible TypeScript, npm installs one copy for both. Only the parser is used: no type checking, no `tsconfig`, and nothing is compiled or run.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

---

Maintained by [BYD Tech](https://bydtech.in), a software studio that builds MVPs, AI agents, and web & mobile apps.

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-16

### Added

- `next-check-links`: fails when a Next.js app links to one of its own routes that nothing serves, reading the source rather than built pages. Exit codes 0, 1 and 2; `text`, `json` and `github` output.
- Route table from the App Router (pages, route handlers, dynamic, catch-all and optional catch-all segments, route groups, parallel slots, intercepting and private segments, metadata files), the Pages Router, `public/`, and literal redirect and rewrite sources, `basePath`, `pageExtensions` and `i18n.locales` from `next.config`, read without running it.
- Links from JSX `href`, `href` object properties, `router.push`/`replace`/`prefetch`, `redirect()`/`permanentRedirect()`, `NextResponse.redirect`/`rewrite`, `{ pathname }` objects and configured route files, parsed with the TypeScript parser; template literals keep `${…}` segments, which land only on dynamic routes.
- The closest existing route as a suggestion for each broken link.
- `--allow`, `--include`, `--exclude`, `--route-file`, `--base-path`, `--page-extensions`, `--no-next-config`, and `next-check-links.config.{json,mjs}`.
- API: `checkLinks`, `loadConfig`, `formatReport`, `appRoutes`, `pagesRoutes`, `publicRoutes`, `readNextConfig`, `collectLinks`, `matchRoute`, `closestRoute`, `parseSourcePattern`.

[Unreleased]: https://github.com/BYDTechSolutions/next-check-links/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BYDTechSolutions/next-check-links/releases/tag/v0.1.0

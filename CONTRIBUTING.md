# Contributing

Thanks for helping. Issues and pull requests are welcome at
[github.com/BYDTechSolutions/next-check-links](https://github.com/BYDTechSolutions/next-check-links).

## Setup

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later.

## Rules

- Routing behavior follows the Next.js documentation for the
  [App Router](https://nextjs.org/docs/app/getting-started/project-structure) and the
  [Pages Router](https://nextjs.org/docs/pages/building-your-application/routing).
  If you change how a file or folder maps to a URL, link the part of the documentation
  that supports the change, and add a test that writes a project showing it.
- Tests build throwaway projects with `project()` from `test/helpers.ts`; they never
  read or change files outside their temporary directory.
- The tool never runs project code: `next.config` and source files are parsed, not
  executed. Keep it that way.
- If you change `examples/demo`, update the output shown in the README; a test compares them.
- No new runtime dependencies without a strong reason, stated in the README.
- Add a line to `CHANGELOG.md` under "Unreleased".
- American English in code, messages and docs.

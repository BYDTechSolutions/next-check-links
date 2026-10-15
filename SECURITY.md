# Security policy

## Reporting a vulnerability

Please email **sales.bydtech@gmail.com** with the details, instead of opening a
public issue. We will acknowledge the report and keep you posted on the fix.

## Scope

The tool reads files under the project root and writes only to stdout and
stderr. It parses `next.config` and source files with the TypeScript parser and
never executes them. The one exception is a `next-check-links.config.mjs` file,
which is imported as code, as any JavaScript config file is: only use one you
trust. It makes no network requests.

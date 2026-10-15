import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkLinks, type CheckOptions } from './check.js';
import { loadConfig } from './config.js';
import { CheckLinksError } from './errors.js';
import { REPORT_FORMATS, formatReport, type ReportFormat } from './report.js';
import { VERSION } from './version.js';

/** Exit codes: 0 every link resolves, 1 broken links, 2 usage or configuration error. */
export const EXIT = { OK: 0, BROKEN: 1, USAGE: 2 } as const;

/** Everything the CLI touches outside itself, so tests can replace it. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const HELP = `next-check-links ${VERSION}: fail when a Next.js app links to a route it does not serve

Usage:
  next-check-links [options]

Options:
  --root <dir>              The Next.js project (default: the current directory)
  --config <file>           Config file (default: next-check-links.config.json or .mjs in the root)
  --include <glob>          Source files to read; repeatable, replaces the default
                            (src/**/* when the routers are under src/, else **/*)
  --exclude <glob>          Source files to skip; repeatable, added to the default list
  --allow <glob>            A path that is known to be fine, e.g. /api/** ; repeatable
  --route-file <glob>       A file whose every "/..." string is a link (a route map); repeatable
  --base-path <path>        Override basePath from next.config
  --page-extensions <list>  Override pageExtensions, comma-separated, e.g. tsx,ts,mdx
  --no-next-config          Do not read next.config
  --format <name>           text, json or github (default: text)
  -h, --help                Show this help
  -v, --version             Show the version

Exit codes: 0 every link resolves, 1 broken links found, 2 usage or configuration error.
`;

class UsageError extends Error {}

/** Runs the CLI with the given arguments and returns the exit code. */
export async function main(args: string[], io: CliIo): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: false,
        strict: true,
        options: {
          root: { type: 'string' },
          config: { type: 'string' },
          include: { type: 'string', multiple: true },
          exclude: { type: 'string', multiple: true },
          allow: { type: 'string', multiple: true },
          'route-file': { type: 'string', multiple: true },
          'base-path': { type: 'string' },
          'page-extensions': { type: 'string' },
          'no-next-config': { type: 'boolean' },
          format: { type: 'string' },
          help: { type: 'boolean', short: 'h' },
          version: { type: 'boolean', short: 'v' },
        },
      });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const v = parsed.values;
    if (v.help) {
      io.stdout(HELP);
      return EXIT.OK;
    }
    if (v.version) {
      io.stdout(`${VERSION}\n`);
      return EXIT.OK;
    }
    const format = (v.format ?? 'text') as ReportFormat;
    if (!REPORT_FORMATS.includes(format)) throw new UsageError(`Unknown format "${v.format}". Use text, json or github.`);

    const root = resolve(io.cwd, v.root ?? '.');
    const { config } = await loadConfig(root, v.config);
    const options: CheckOptions = { ...config, root };
    if (v.include) options.include = v.include;
    if (v.exclude) options.exclude = [...(config.exclude ?? []), ...v.exclude];
    if (v.allow) options.allow = [...(config.allow ?? []), ...v.allow];
    if (v['route-file']) options.routeFiles = [...(config.routeFiles ?? []), ...v['route-file']];
    if (v['base-path'] !== undefined) options.basePath = v['base-path'];
    if (v['page-extensions'] !== undefined) {
      const list = v['page-extensions'].split(',').map((s) => s.trim().replace(/^\./, '')).filter(Boolean);
      if (!list.length) throw new UsageError('--page-extensions needs at least one extension');
      options.pageExtensions = list;
    }
    if (v['no-next-config']) options.nextConfig = false;

    const result = checkLinks(options);
    const report = formatReport(result, format);
    if (format === 'text') {
      for (const w of result.warnings) io.stderr(`warning: ${w}\n`);
      (result.ok ? io.stdout : io.stderr)(report);
    } else {
      io.stdout(report);
    }
    return result.ok ? EXIT.OK : EXIT.BROKEN;
  } catch (error) {
    if (error instanceof UsageError || error instanceof CheckLinksError) {
      io.stderr(`next-check-links: ${error.message}\n`);
      if (error instanceof UsageError) io.stderr('Run next-check-links --help for usage.\n');
      return EXIT.USAGE;
    }
    throw error;
  }
}

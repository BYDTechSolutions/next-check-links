import type { CheckResult } from './check.js';

/** Output formats. `github` writes workflow commands that annotate the pull request. */
export type ReportFormat = 'text' | 'json' | 'github';
export const REPORT_FORMATS: readonly ReportFormat[] = ['text', 'json', 'github'];

function summary(result: CheckResult): string {
  const pageRoutes = result.routes.filter((r) => r.source !== 'public').length;
  const allowed = result.allowed.length ? `, ${result.allowed.length} allowed` : '';
  return `${result.links.length} internal links in ${result.filesScanned} files, ${pageRoutes} routes${allowed}`;
}

/** A report for a person: one block per broken link, then a summary line. */
export function formatText(result: CheckResult): string {
  if (result.ok) return `next-check-links: OK. ${summary(result)}; every link resolves.\n`;
  const lines = [`next-check-links: ${result.broken.length} broken link(s). ${summary(result)}.`, ''];
  for (const b of result.broken) {
    lines.push(`${b.file}:${b.line}:${b.column}  ${b.raw}`);
    lines.push(`  ${b.reason}`);
    if (b.suggestion) lines.push(`  closest route: ${b.suggestion}`);
    lines.push('');
  }
  lines.push('Add the route, fix the link, or list a known-good path with --allow.');
  return lines.join('\n') + '\n';
}

/** The whole result as JSON, without the route and link tables' internals. */
export function formatJson(result: CheckResult): string {
  const strip = <T extends { segments: unknown }>({ segments: _segments, ...rest }: T) => rest;
  return (
    JSON.stringify(
      {
        ok: result.ok,
        root: result.root,
        appDir: result.appDir,
        pagesDir: result.pagesDir,
        nextConfig: result.nextConfig,
        basePath: result.basePath,
        filesScanned: result.filesScanned,
        linksChecked: result.links.length,
        broken: result.broken.map(strip),
        allowed: result.allowed.map(strip),
        routes: result.routes.map(strip),
        warnings: result.warnings,
      },
      null,
      2,
    ) + '\n'
  );
}

const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** GitHub Actions workflow commands: an error annotation on each broken link's line. */
export function formatGithub(result: CheckResult): string {
  const lines: string[] = [];
  for (const w of result.warnings) lines.push(`::warning title=next-check-links::${escapeData(w)}`);
  for (const b of result.broken) {
    const message = `${b.raw}: ${b.reason}${b.suggestion ? `\nclosest route: ${b.suggestion}` : ''}`;
    lines.push(
      `::error file=${escapeProperty(b.file)},line=${b.line},col=${b.column},title=${escapeProperty('Broken internal link')}::${escapeData(message)}`,
    );
  }
  lines.push(result.ok ? `next-check-links: OK. ${summary(result)}.` : `next-check-links: ${result.broken.length} broken link(s). ${summary(result)}.`);
  return lines.join('\n') + '\n';
}

/** Formats a result in the given format. */
export function formatReport(result: CheckResult, format: ReportFormat = 'text'): string {
  if (format === 'json') return formatJson(result);
  if (format === 'github') return formatGithub(result);
  return formatText(result);
}

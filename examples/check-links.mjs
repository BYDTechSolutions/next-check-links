// Run the check from a script and decide what to do with the result.
//
//   node examples/check-links.mjs [project-dir]
//   node examples/check-links.mjs examples/demo
import { checkLinks, formatReport, loadConfig } from '@bydtech/next-check-links';

const root = process.argv[2] ?? '.';
const { config } = await loadConfig(root);
const result = checkLinks({ ...config, root });

for (const link of result.broken) {
  const hint = link.suggestion ? ` (did you mean ${link.suggestion}?)` : '';
  console.error(`${link.file}:${link.line}  ${link.raw}${hint}`);
}
console.log(formatReport(result, 'text').split('\n')[0]);
process.exitCode = result.ok ? 0 : 1;

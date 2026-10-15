import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { parseSourcePattern, type RouteSegment } from './routes.js';
import { scriptKindFor } from './source.js';

/** A redirect or rewrite whose `source` is a literal in `next.config`. */
export interface ConfigRouteEntry {
  kind: 'redirect' | 'rewrite';
  source: string;
  segments: RouteSegment[];
  /** `basePath: false` on the entry: the source is not under `basePath`. */
  absolute: boolean;
  line: number;
}

/** What could be read from `next.config` without running it. */
export interface NextConfigInfo {
  /** The config file, or undefined when there is none. */
  file?: string;
  basePath?: string;
  pageExtensions?: string[];
  /** `i18n.locales`, for the Pages Router's locale prefixes. */
  locales?: string[];
  entries: ConfigRouteEntry[];
  /** Things that were there but could not be read statically. */
  warnings: string[];
}

export const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];

/** Finds the project's `next.config.*`, in the order Next.js would. */
export function findNextConfig(root: string): string | undefined {
  for (const name of NEXT_CONFIG_FILES) {
    const p = join(root, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function literalString(node: ts.Expression): string | undefined {
  const n = unwrap(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return undefined;
}

/** A string array, or a ternary choosing between string arrays (both branches are kept). */
function literalStringArray(node: ts.Expression): string[] | undefined {
  const n = unwrap(node);
  if (ts.isConditionalExpression(n)) {
    const a = literalStringArray(n.whenTrue);
    const b = literalStringArray(n.whenFalse);
    return a && b ? [...new Set([...a, ...b])] : undefined;
  }
  if (!ts.isArrayLiteralExpression(n)) return undefined;
  const out: string[] = [];
  for (const el of n.elements) {
    const s = literalString(el as ts.Expression);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

/** An identifier used as a value that could be a list of entries, not as a name or a call. */
function isValuePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ts.isReturnStatement(parent) ||
    (ts.isArrowFunction(parent) && parent.body === node) ||
    ts.isSpreadElement(parent) ||
    ts.isSpreadAssignment(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node)
  );
}

/**
 * Reads `basePath`, `pageExtensions`, `i18n.locales` and the `source` of every
 * redirect and rewrite from `next.config`, without running it.
 *
 * Running the config would execute the project's code and need its
 * dependencies installed; reading it only sees values written as literals. A
 * value built at runtime (an environment variable, a fetched list) is reported
 * in `warnings` and otherwise ignored.
 */
export function readNextConfig(file: string): NextConfigInfo {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const info: NextConfigInfo = { file, entries: [], warnings: [] };
  const name = basename(file);
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // `const` declarations in the file, so `redirects: async () => list` can be followed.
  const consts = new Map<string, ts.Expression>();
  const findConsts = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, findConsts);
  };
  findConsts(sf);

  const collectEntries = (body: ts.Node, kind: 'redirect' | 'rewrite') => {
    const followed = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && isValuePosition(node) && consts.has(node.text) && !followed.has(node.text)) {
        followed.add(node.text);
        visit(consts.get(node.text)!);
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const props = new Map<string, ts.Expression>();
        for (const p of node.properties) {
          if (ts.isPropertyAssignment(p)) {
            const key = propertyName(p.name);
            if (key) props.set(key, p.initializer);
          }
        }
        const sourceNode = props.get('source');
        if (sourceNode) {
          const source = literalString(sourceNode);
          if (source === undefined) {
            info.warnings.push(`${name}:${lineOf(sourceNode)}: a ${kind} source is not a literal string; it was skipped`);
          } else {
            const basePathNode = props.get('basePath');
            const absolute = !!basePathNode && unwrap(basePathNode).kind === ts.SyntaxKind.FalseKeyword;
            info.entries.push({ kind, source, segments: parseSourcePattern(source), absolute, line: lineOf(node) });
          }
          return;
        }
      }
      if ((ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) && !(ts.isIdentifier(node.expression) && consts.has(node.expression.text))) {
        info.warnings.push(`${name}:${lineOf(node)}: a spread inside ${kind}s() was not followed; entries it adds are not known`);
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  };

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
      const key = propertyName(node.name);
      const value = ts.isPropertyAssignment(node) ? unwrap(node.initializer) : undefined;
      if (key === 'basePath' && value) {
        const s = literalString(value);
        if (s !== undefined) info.basePath = s;
        else info.warnings.push(`${name}:${lineOf(node)}: basePath is not a literal string; pass --base-path if it is set`);
      } else if (key === 'pageExtensions' && value) {
        const list = literalStringArray(value);
        if (list) info.pageExtensions = list;
        else info.warnings.push(`${name}:${lineOf(node)}: pageExtensions is not a literal array; pass --page-extensions if it is set`);
      } else if (key === 'locales' && value) {
        const list = literalStringArray(value);
        if (list) info.locales = list;
      } else if (key === 'redirects' || key === 'rewrites') {
        const kind = key === 'redirects' ? 'redirect' : 'rewrite';
        const fn = ts.isMethodDeclaration(node) ? node : value;
        if (fn && (ts.isMethodDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          collectEntries(fn, kind);
        } else if (fn) {
          info.warnings.push(`${name}:${lineOf(node)}: ${key} is not written inline; its entries are not known`);
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return info;
}

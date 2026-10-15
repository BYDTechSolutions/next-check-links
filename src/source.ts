import ts from 'typescript';
import type { PathSegment } from './routes.js';

/** How a link was written, which decides how `basePath` applies to it. */
export type LinkKind =
  /** A JSX `href` attribute, e.g. `<Link href="/x">` or `<a href="/x">`. */
  | 'jsx-href'
  /** An `href` property in an object, e.g. `{ label: 'Work', href: '/work' }`. */
  | 'object-href'
  /** `router.push`, `router.replace` or `router.prefetch`. */
  | 'router'
  /** `redirect()` or `permanentRedirect()` from `next/navigation`, `NextResponse.redirect` or `.rewrite`. */
  | 'redirect'
  /** A string in one of the configured route files. */
  | 'constant';

/** One internal link found in the source. */
export interface Link {
  /** The file, relative to the root, with `/` separators. */
  file: string;
  line: number;
  column: number;
  /** The link as written, with any `${...}` kept, e.g. `/work/${slug}?tab=1`. */
  raw: string;
  /** The path the route is decided by: query and hash removed, no trailing slash. */
  path: string;
  segments: PathSegment[];
  kind: LinkKind;
  /** For `jsx-href`: the element, e.g. `Link` or `a`. */
  element?: string;
}

/** Options for {@link collectLinks}. */
export interface CollectOptions {
  /** Treat every string that starts with `/` as a link (for route-map files). */
  allStrings?: boolean;
  /** JSX attributes and object keys read as links. Default `['href']`. */
  hrefNames?: readonly string[];
}

/** A piece of a value only known at runtime, keeping its source text for messages. */
export interface Hole {
  hole: string;
}
/** One piece of a candidate link: literal text, or a runtime value. */
export type Part = string | Hole;
type Candidate = Part[];
const isHole = (p: Part): p is Hole => typeof p !== 'string';

/** The `ScriptKind` for a file name, so JSX in `.js` files parses too. */
export function scriptKindFor(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[mc]?ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
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

function nameOf(node: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/**
 * Turns the parts of a candidate into a link, or null when it is not an
 * internal path: it must start with a single `/`, as written in the source.
 */
export function toPath(parts: readonly Part[]): { raw: string; path: string; segments: PathSegment[] } | null {
  const first = parts[0];
  if (typeof first !== 'string' || !first.startsWith('/') || first.startsWith('//')) return null;
  // Literal text with whitespace is a sentence or a pattern, not a path.
  if (parts.some((p) => typeof p === 'string' && /\s/.test(p))) return null;
  const raw = parts.map((p) => (typeof p === 'string' ? p : `\${${p.hole}}`)).join('');

  // Keep only what comes before the first `?` or `#` in a literal part.
  const kept: Part[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      const cut = p.search(/[?#]/);
      if (cut >= 0) {
        kept.push(p.slice(0, cut));
        break;
      }
    }
    kept.push(p);
  }

  const segments: PathSegment[] = [];
  let text = '';
  let hasHole = false;
  const flush = () => {
    if (hasHole) segments.push({ kind: 'param', text });
    else if (text) {
      let value = text;
      try {
        value = decodeURIComponent(text);
      } catch {
        // keep as written
      }
      segments.push({ kind: 'static', value });
    }
    text = '';
    hasHole = false;
  };
  for (const p of kept) {
    if (typeof p !== 'string') {
      text += `\${${p.hole}}`;
      hasHole = true;
      continue;
    }
    const pieces = p.split('/');
    pieces.forEach((piece, i) => {
      if (i > 0) flush();
      text += piece;
    });
  }
  flush();

  // A path that is nothing but runtime values says nothing about which route it names.
  if (segments.length > 0 && segments.every((s) => s.kind === 'param')) return null;
  const path = segments.length === 0 ? '/' : segments.map((s) => `/${s.kind === 'static' ? s.value : s.text}`).join('');
  return { raw, path, segments };
}

/**
 * Finds every internal link in one source file, by walking its syntax tree.
 *
 * Read as links: JSX `href` attributes; `href` properties in object literals;
 * the first argument of `push`, `replace` and `prefetch` on a router from
 * `useRouter()` (or a variable named `router` or `Router`); `redirect()` and
 * `permanentRedirect()` imported from `next/navigation`; and
 * `NextResponse.redirect()` and `.rewrite()`. With `allStrings`, every string
 * that starts with `/` as well.
 *
 * A value is followed through ternaries, `??`, `||`, `&&`, `+`, template
 * literals, `as` and `satisfies`, `{ pathname }` objects, `new URL(path, base)`
 * and `const` strings declared in the same file. Anything else is a runtime
 * value: inside a template it becomes a `${…}` segment, on its own it is skipped.
 */
export function collectLinks(file: string, text: string, options: CollectOptions = {}): Link[] {
  const hrefNames = new Set(options.hrefNames ?? ['href']);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const links: Link[] = [];
  const seen = new Set<string>();

  // Pass 1: const strings, router variables, and the local names of next/navigation's redirects.
  const consts = new Map<string, ts.Expression[]>();
  const routerVars = new Set<string>(['router', 'Router']);
  const routerFns = new Set<string>();
  const redirectFns = new Set<string>();
  const prepare = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      const isUseRouter = ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useRouter';
      if (ts.isIdentifier(node.name)) {
        if (isUseRouter) routerVars.add(node.name.text);
        if (ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const) {
          const list = consts.get(node.name.text) ?? [];
          list.push(node.initializer);
          consts.set(node.name.text, list);
        }
      } else if (ts.isObjectBindingPattern(node.name) && isUseRouter) {
        for (const el of node.name.elements) {
          const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '';
          if (['push', 'replace', 'prefetch'].includes(prop) && ts.isIdentifier(el.name)) routerFns.add(el.name.text);
        }
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'next/navigation') {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (imported === 'redirect' || imported === 'permanentRedirect') redirectFns.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, prepare);
  };
  prepare(sf);

  const evaluate = (node: ts.Expression, depth = 0, allowObject = false): Candidate[] => {
    if (depth > 20) return [];
    const n = unwrap(node);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [[n.text]];
    if (ts.isTemplateExpression(n)) {
      let results: Candidate[] = [[n.head.text]];
      for (const span of n.templateSpans) {
        const inner = evaluate(span.expression, depth + 1);
        // A span that is a known string is inlined; anything else is a runtime value.
        const hole: Candidate = [{ hole: span.expression.getText(sf) }];
        const options: Candidate[] = inner.length > 0 && inner.every((c) => !c.some(isHole)) ? inner : [hole];
        const next: Candidate[] = [];
        for (const r of results) for (const o of options) next.push([...r, ...o, span.literal.text]);
        results = next.slice(0, 64);
      }
      return results;
    }
    if (ts.isConditionalExpression(n)) return [...evaluate(n.whenTrue, depth + 1), ...evaluate(n.whenFalse, depth + 1)];
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return [...evaluate(n.left, depth + 1), ...evaluate(n.right, depth + 1)];
      }
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return evaluate(n.right, depth + 1);
      if (op === ts.SyntaxKind.PlusToken) {
        const left = evaluate(n.left, depth + 1);
        const right = evaluate(n.right, depth + 1);
        const l: Candidate[] = left.length ? left : [[{ hole: n.left.getText(sf) }]];
        const r: Candidate[] = right.length ? right : [[{ hole: n.right.getText(sf) }]];
        if (!left.length && !right.length) return [];
        const out: Candidate[] = [];
        for (const a of l) for (const b of r) out.push([...a, ...b]);
        return out.slice(0, 64);
      }
      return [];
    }
    if (ts.isIdentifier(n)) {
      const decls = consts.get(n.text);
      // Only a name declared once in the file: with two, which one is in scope is not known here.
      if (decls && decls.length === 1) return evaluate(decls[0]!, depth + 1, allowObject);
      return [];
    }
    if (allowObject && ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && nameOf(p.name) === 'pathname') return evaluate(p.initializer, depth + 1);
      }
      return [];
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL' && n.arguments?.length === 2) {
      return evaluate(n.arguments[0]!, depth + 1);
    }
    return [];
  };

  // Strings already read as part of an href, so `allStrings` does not report them twice.
  const handled = new Set<number>();
  const markHandled = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) handled.add(node.getStart(sf));
    ts.forEachChild(node, markHandled);
  };

  const add = (node: ts.Node, value: ts.Expression, kind: LinkKind, element?: string) => {
    if (kind === 'constant') {
      if (handled.has(value.getStart(sf))) return;
    } else {
      markHandled(value);
    }
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    for (const candidate of evaluate(value, 0, kind !== 'constant')) {
      const parsed = toPath(candidate);
      if (!parsed) continue;
      const key = `${pos.line}:${pos.character}:${parsed.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ file, line: pos.line + 1, column: pos.character + 1, ...parsed, kind, ...(element ? { element } : {}) });
    }
  };

  const elementName = (tag: ts.JsxTagNameExpression): string => tag.getText(sf);

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) {
      const attr = nameOf(node.name as ts.JsxAttributeName);
      if (attr && hrefNames.has(attr) && node.initializer) {
        const opening = node.parent.parent;
        const element = ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening) ? elementName(opening.tagName) : undefined;
        const init = node.initializer;
        if (ts.isStringLiteral(init)) add(node, init, 'jsx-href', element);
        else if (ts.isJsxExpression(init) && init.expression) add(node, init.expression, 'jsx-href', element);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const key = nameOf(node.name);
      if (key && hrefNames.has(key)) add(node, node.initializer, 'object-href');
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const arg = node.arguments[0]!;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const target = unwrap(callee.expression);
        const isRouter =
          (ts.isIdentifier(target) && routerVars.has(target.text)) ||
          (ts.isCallExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === 'useRouter');
        if (isRouter && ['push', 'replace', 'prefetch'].includes(method)) add(node, arg, 'router');
        if (ts.isIdentifier(target) && target.text === 'NextResponse' && (method === 'redirect' || method === 'rewrite')) {
          add(node, arg, 'redirect');
        }
      } else if (ts.isIdentifier(callee)) {
        if (redirectFns.has(callee.text)) add(node, arg, 'redirect');
        else if (routerFns.has(callee.text)) add(node, arg, 'router');
      }
    }
    if (options.allStrings && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
      const parent = node.parent;
      const isModuleName = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent);
      if (!isModuleName && !ts.isLiteralTypeNode(parent)) add(node, node as ts.Expression, 'constant');
      if (ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return links;
}

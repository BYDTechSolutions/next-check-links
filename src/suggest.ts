import type { PathSegment, Route } from './routes.js';

/** Edit distance between two strings (insert, delete, substitute; each costs 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** A route reduced to its shape: dynamic segments become `*`, catch-alls `**`. */
function routeShape(route: Route): string {
  if (route.segments.length === 0) return '/';
  return route.segments.map((s) => '/' + (s.kind === 'static' ? s.value : s.kind === 'dynamic' ? '*' : '**')).join('');
}

function pathShape(segments: readonly PathSegment[]): string {
  if (segments.length === 0) return '/';
  return segments.map((s) => '/' + (s.kind === 'static' ? s.value : '*')).join('');
}

/**
 * The existing route closest to a path that nothing serves, or undefined when
 * nothing is close enough to be a likely typo or rename. Files in `public/`
 * are only suggested for a path that looks like a file (its last segment has a dot).
 */
export function closestRoute(segments: readonly PathSegment[], routes: readonly Route[]): string | undefined {
  const target = pathShape(segments);
  const last = segments[segments.length - 1];
  const looksLikeFile = !!last && last.kind === 'static' && last.value.includes('.');
  let best: { pattern: string; distance: number } | undefined;
  const seen = new Set<string>();
  for (const route of routes) {
    if (route.source === 'public' && !looksLikeFile) continue;
    if (seen.has(route.pattern)) continue;
    seen.add(route.pattern);
    const distance = levenshtein(target, routeShape(route));
    if (!best || distance < best.distance || (distance === best.distance && route.pattern.length < best.pattern.length)) {
      best = { pattern: route.pattern, distance };
    }
  }
  if (!best) return undefined;
  const limit = Math.max(3, Math.ceil(target.length * 0.4));
  return best.distance <= limit ? best.pattern : undefined;
}

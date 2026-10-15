/**
 * Fail the build when a Next.js app links to one of its own routes that does
 * not exist, read from the source rather than the built pages.
 *
 * @packageDocumentation
 */
export { checkLinks, findRouterDirs, DEFAULT_EXCLUDE, DEFAULT_PAGE_EXTENSIONS, type BrokenLink, type CheckOptions, type CheckResult } from './check.js';
export { CONFIG_FILES, loadConfig, validateConfig, type FileConfig } from './config.js';
export { CheckLinksError, type CheckLinksErrorCode } from './errors.js';
export { globMatcher, globToRegExp } from './glob.js';
export { findNextConfig, readNextConfig, type ConfigRouteEntry, type NextConfigInfo } from './next-config.js';
export { formatGithub, formatJson, formatReport, formatText, REPORT_FORMATS, type ReportFormat } from './report.js';
export {
  appRoutes,
  formatRoute,
  matchRoute,
  pagesRoutes,
  parseFolderSegment,
  parseSourcePattern,
  publicRoutes,
  type PathSegment,
  type Route,
  type RouteSegment,
  type RouteSource,
} from './routes.js';
export { collectLinks, toPath, type CollectOptions, type Hole, type Link, type LinkKind, type Part } from './source.js';
export { closestRoute, levenshtein } from './suggest.js';
export { VERSION } from './version.js';

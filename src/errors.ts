/**
 * Why a check could not run at all (as opposed to finding broken links).
 *
 * - `NO_ROUTER`: neither `app/` nor `pages/` (nor their `src/` versions) exists under the root.
 * - `NO_ROOT`: the root directory does not exist.
 * - `CONFIG`: the config file could not be read, or holds a value of the wrong type.
 * - `INVALID_OPTION`: an option has an impossible value.
 */
export type CheckLinksErrorCode = 'NO_ROUTER' | 'NO_ROOT' | 'CONFIG' | 'INVALID_OPTION';

/** An error with a stable `code` and a message written for a person to read. */
export class CheckLinksError extends Error {
  readonly code: CheckLinksErrorCode;

  constructor(code: CheckLinksErrorCode, message: string) {
    super(message);
    this.name = 'CheckLinksError';
    this.code = code;
  }
}

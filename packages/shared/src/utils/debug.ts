// ---------------------------------------------------------------------------
// Debug utility — centralized logging gated by window.debugLevel
// ---------------------------------------------------------------------------
// Usage:
//   import { DBG, createDebugLogger } from '@ezmusic/shared';
//   const dbg = createDebugLogger('Tuner');
//   dbg.debug('%c🔍 detection result', 'color:#f5a623');
//   dbg.group('High-Note Diag', 'color:#68f0a5', DBG.DEBUG);
//   dbg.debug('RMS: %s', rms);
//   dbg.groupEnd();
// ---------------------------------------------------------------------------

// ---- Level constants -------------------------------------------------------

export const DBG = {
  /** No debug output whatsoever. */
  SILENT: 0,
  /** Critical errors only. */
  ERROR: 1,
  /** Warnings and errors. */
  WARN: 2,
  /** Informational messages (user-visible events). */
  INFO: 3,
  /** Detailed diagnostics (throttled per-frame logs, YIN internals). */
  DEBUG: 4,
  /** Everything including burst / frame-by-frame trace. */
  TRACE: 5,
} as const;

export type DebugLevel = (typeof DBG)[keyof typeof DBG];

// ---- Global debug level on window ------------------------------------------

declare global {
  interface Window {
    /**
     * Global debug verbosity level.
     * - 0 (SILENT): no debug output
     * - 1 (ERROR): only console.error
     * - 2 (WARN):  + console.warn
     * - 3 (INFO):  + informational logs
     * - 4 (DEBUG): + detailed per-frame diagnostics, YIN internals
     * - 5 (TRACE): + burst logs, frame-by-frame trace
     *
     * Set via the browser console: `window.debugLevel = 5`
     */
    debugLevel: number;
  }
}

/** Ensure window.debugLevel exists, setting a default when absent. */
export function ensureDebugLevel(defaultLevel: number = DBG.SILENT): number {
  if (typeof window !== 'undefined') {
    if (window.debugLevel === undefined || window.debugLevel === null) {
      window.debugLevel = defaultLevel;
    }
    return window.debugLevel;
  }
  return defaultLevel;
}

/** Override the global debug level at runtime or from app bootstrap. */
export function setDebugLevel(level: number): void {
  if (typeof window !== 'undefined') {
    window.debugLevel = level;
  }
}

/** Read the current global debug level. */
export function getDebugLevel(): number {
  if (typeof window !== 'undefined') {
    return window.debugLevel ?? DBG.SILENT;
  }
  return DBG.SILENT;
}

// ---- Logger interface ------------------------------------------------------

export interface DebugLogger {
  /** Always logs — use for unrecoverable / system errors. */
  error: (...args: any[]) => void;

  /** Logs when debugLevel ≥ WARN. */
  warn: (...args: any[]) => void;

  /** Logs when debugLevel ≥ INFO. User-visible lifecycle events. */
  info: (...args: any[]) => void;

  /** Logs when debugLevel ≥ DEBUG. Main diagnostic output. */
  debug: (...args: any[]) => void;

  /**
   * Logs when debugLevel ≥ TRACE.
   * Frame-by-frame, burst, and other extremely verbose output.
   */
  trace: (...args: any[]) => void;

  /**
   * Open a console.group when debugLevel ≥ `level` (default DBG.DEBUG).
   * Call {@link groupEnd} after the group's contents.
   *
   * @param label  Group title (may include %c formatting).
   * @param css    Optional CSS string for the %c placeholder in `label`.
   * @param level  Minimum debugLevel required to show this group.
   * @returns      `true` if the group was actually opened.
   */
  group: (label: string, css?: string, level?: number) => boolean;

  /** Close the most recently opened console group. */
  groupEnd: () => void;

  /** Check whether output at the given level would be visible. */
  enabled: (level: number) => boolean;
}

// ---- Factory ---------------------------------------------------------------

/**
 * Create a namespaced debug logger.
 *
 * All output is gated by `window.debugLevel`. The namespace appears as a
 * `[Tag]` prefix so log lines are easy to attribute.
 *
 * @example
 * ```ts
 * const dbg = createDebugLogger('Tuner');
 * dbg.debug('%c🔍 YIN detect #%d', 'color:#f5a623;font-weight:bold', n);
 * dbg.group('🎵 Frame Diagnostics', 'color:#68f0a5', DBG.DEBUG);
 * dbg.debug('sampleRate: %d', sr);
 * dbg.groupEnd();
 * ```
 */
export function createDebugLogger(namespace: string): DebugLogger {
  const tag = `[${namespace}]`;

  const currentLevel = (): number => {
    if (typeof window !== 'undefined') {
      return window.debugLevel ?? DBG.SILENT;
    }
    return DBG.SILENT;
  };

  const enabled = (level: number): boolean => currentLevel() >= level;

  const error = (...args: any[]): void => {
    if (enabled(DBG.ERROR)) console.error(tag, ...args);
  };

  const warn = (...args: any[]): void => {
    if (enabled(DBG.WARN)) console.warn(tag, ...args);
  };

  const info = (...args: any[]): void => {
    if (enabled(DBG.INFO)) console.info(tag, ...args);
  };

  const debug = (...args: any[]): void => {
    if (enabled(DBG.DEBUG)) console.log(tag, ...args);
  };

  const trace = (...args: any[]): void => {
    if (enabled(DBG.TRACE)) console.log(tag, ...args);
  };

  const group = (label: string, css?: string, level: number = DBG.DEBUG): boolean => {
    if (enabled(level)) {
      if (css) {
        console.group(`%c${tag} ${label}`, css);
      } else {
        console.group(`${tag} ${label}`);
      }
      return true;
    }
    return false;
  };

  const groupEnd = (): void => {
    console.groupEnd();
  };

  return { error, warn, info, debug, trace, group, groupEnd, enabled };
}

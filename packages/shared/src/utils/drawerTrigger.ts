/**
 * Module-level navigation trigger for cross-package mobile navigation.
 *
 * The app shell (AppShell) registers a callback on mount. Individual drill
 * components call `triggerOpenDrawer()` from their top-bar back button to
 * return to the instrument home, without threading props through the tree.
 *
 * Note: the name is kept for backwards compatibility; the registered action
 * is now "navigate back" rather than "open a drawer".
 */

let _drawerTrigger: (() => void) | null = null;

/** Register the navigation callback. Called by the app shell. */
export function setDrawerTrigger(fn: (() => void) | null): void {
  _drawerTrigger = fn;
}

/** Invoke the registered navigation action. Safe to call with no trigger set. */
export function triggerOpenDrawer(): void {
  _drawerTrigger?.();
}

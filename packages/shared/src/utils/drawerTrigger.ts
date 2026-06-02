/**
 * Module-level drawer trigger for cross-package mobile navigation.
 *
 * The app layout (Articles) registers a callback on mount. Individual drill
 * components can call `triggerOpenDrawer()` from their hamburger buttons
 * without needing to thread props through the component tree.
 */

let _drawerTrigger: (() => void) | null = null;

/** Register the drawer-open callback. Called by the layout component. */
export function setDrawerTrigger(fn: (() => void) | null): void {
  _drawerTrigger = fn;
}

/** Open the mobile navigation drawer. Safe to call even when no trigger is registered. */
export function triggerOpenDrawer(): void {
  _drawerTrigger?.();
}

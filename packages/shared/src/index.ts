export { default as i18n } from './i18n';
export { supportedLocales } from './i18n';
export type { SupportedLocale } from './i18n';

export * from './music';

export { default as PianoKeyboard } from './components/PianoKeyboard';
export type { PianoKeyboardProps, KeyHighlight, KeyHighlightState } from './components/PianoKeyboard';

export { default as GuitarFretboard } from './components/GuitarFretboard';
export type { GuitarFretboardProps } from './components/GuitarFretboard';

export { setDrawerTrigger, triggerOpenDrawer } from './utils/drawerTrigger';

export {
  DBG,
  ensureDebugLevel,
  setDebugLevel,
  getDebugLevel,
  createDebugLogger,
} from './utils/debug';
export type { DebugLevel, DebugLogger } from './utils/debug';

// UI kit (Radix + Tailwind, shadcn/ui pattern)
export * from './ui';

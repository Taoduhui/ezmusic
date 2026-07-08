import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  supportedLocales,
  i18n,
  setDrawerTrigger,
  Select,
  Button,
  cn,
  ReloadOutlined,
  ChevronRightIcon,
  ChevronLeftIcon,
  message,
  useAudio,
  PianoKeyboard,
} from '@ezmusic/shared';
import type { SupportedLocale } from '@ezmusic/shared';
import {
  GraduationCap,
  BarChart3,
  User,
  ArrowLeftRight,
  Music2,
  Sparkles,
  Lock,
  ChevronDown,
  Settings,
  Mic,
  Activity,
  SlidersHorizontal,
  Play,
  Square,
  RotateCcw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

export interface PageConfig {
  path: string;
  title: string;
  page: () => ReactNode;
}

export interface LessonConfig {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Real drill route this lesson opens. Omitted when locked. */
  path?: string;
  progress?: { done: number; total: number };
  locked?: boolean;
  /** Renders as the highlighted "start test" CTA. */
  test?: boolean;
}

export type ModuleKind = 'lessons' | 'virtual' | 'drill' | 'locked';

export interface ModuleConfig {
  id: string;
  title: string;
  subtitle: string;
  /** Longer description shown in the module-detail hero. */
  heroDesc?: string;
  icon: LucideIcon;
  /** Accent index (0 blue, 1 purple, 2 teal). */
  accent: number;
  kind: ModuleKind;
  lessons?: LessonConfig[];
  /** Drill route for kind==='drill'. */
  path?: string;
}

export interface InstrumentConfig {
  id: string;
  title: string;
  en: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  modules: ModuleConfig[];
}

export interface AppShellProps {
  pages: PageConfig[];
  instruments: InstrumentConfig[];
}

const STORAGE_KEY = 'ezmusic.instrument';

/** Accent palette cycled across module / lesson chips (matches the reference). */
const ACCENTS = [
  { chip: 'from-blue-500 to-indigo-600', border: 'border-blue-400/25', glow: 'bg-blue-500/[0.07]', ring: 'ring-blue-400/30', bar: 'bg-blue-400' },
  { chip: 'from-fuchsia-500 to-violet-600', border: 'border-fuchsia-400/25', glow: 'bg-fuchsia-500/[0.07]', ring: 'ring-fuchsia-400/30', bar: 'bg-fuchsia-400' },
  { chip: 'from-emerald-500 to-teal-600', border: 'border-emerald-400/25', glow: 'bg-emerald-500/[0.07]', ring: 'ring-emerald-400/30', bar: 'bg-emerald-400' },
] as const;

function accentOf(i: number) {
  return ACCENTS[((i % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
}

function loadSavedInstrument(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function AppShell({ pages, instruments }: AppShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string | null>(() => loadSavedInstrument());

  const pathname = useMemo(() => {
    const p = location.pathname;
    return p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
  }, [location.pathname]);

  const segments = useMemo(() => pathname.split('/').filter(Boolean), [pathname]);

  const currentPage = useMemo(
    () => pages.find((p) => p.path === pathname) ?? null,
    [pages, pathname],
  );

  const isValidInstrument = useCallback(
    (id: string | null): id is string => !!id && instruments.some((i) => i.id === id),
    [instruments],
  );

  // Route inside the /i/:inst[/:module] tree
  const routeInstrumentId = segments[0] === 'i' ? segments[1] ?? null : null;
  const routeModuleId = segments[0] === 'i' ? segments[2] ?? null : null;

  const activeInstrumentId = routeInstrumentId ?? selected ?? null;

  // Persist instrument context.
  useEffect(() => {
    if (isValidInstrument(routeInstrumentId) && routeInstrumentId !== selected) {
      setSelected(routeInstrumentId);
      try {
        localStorage.setItem(STORAGE_KEY, routeInstrumentId);
      } catch {
        /* ignore */
      }
    }
  }, [routeInstrumentId, isValidInstrument, selected]);

  // Root redirect: onboarding when nothing chosen, else into the saved instrument.
  useEffect(() => {
    if (pathname !== '/') return;
    if (isValidInstrument(selected)) {
      navigate(`/i/${selected}`, { replace: true });
    } else {
      navigate('/instruments', { replace: true });
    }
  }, [pathname, selected, isValidInstrument, navigate]);

  const navTo = useCallback(
    (path: string) => {
      navigate(path);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [navigate],
  );

  const selectInstrument = useCallback(
    (id: string) => {
      setSelected(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      navTo(`/i/${id}`);
    },
    [navTo],
  );

  const openModule = useCallback(
    (instId: string, mod: ModuleConfig) => {
      if (mod.kind === 'locked') return;
      if (mod.kind === 'drill' && mod.path) {
        navTo(mod.path);
        return;
      }
      navTo(`/i/${instId}/${mod.id}`);
    },
    [navTo],
  );

  // The drills already call triggerOpenDrawer() from their top-bar button;
  // wire it to native "back" (history), which returns to the lesson list.
  useEffect(() => {
    setDrawerTrigger(() => {
      navigate(-1);
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => setDrawerTrigger(null);
  }, [navigate]);

  // ---- Screen selection -------------------------------------------------
  const hasInstrument = isValidInstrument(selected);
  const instrument = instruments.find((i) => i.id === routeInstrumentId) ?? null;
  const activeModule = instrument?.modules.find((m) => m.id === routeModuleId) ?? null;

  let screen: ReactNode;
  if (currentPage) {
    screen = currentPage.page();
  } else if (pathname === '/me') {
    screen = <MineScreen onSwitchInstrument={() => navTo('/instruments')} />;
  } else if (pathname === '/records') {
    screen = <RecordsScreen />;
  } else if (pathname === '/instruments') {
    screen = (
      <InstrumentPicker
        instruments={instruments}
        selected={selected}
        onSelect={selectInstrument}
        onBack={hasInstrument ? () => navTo(`/i/${selected}`) : undefined}
      />
    );
  } else if (instrument && activeModule) {
    screen =
      activeModule.kind === 'virtual' ? (
        <VirtualInstrument module={activeModule} onBack={() => navTo(`/i/${instrument.id}`)} />
      ) : (
        <ModuleDetail
          module={activeModule}
          onBack={() => navTo(`/i/${instrument.id}`)}
          onOpenLesson={(path) => navTo(path)}
        />
      );
  } else if (instrument) {
    screen = (
      <ModuleList
        instrument={instrument}
        onOpenModule={(mod) => openModule(instrument.id, mod)}
        onSwitch={() => navTo('/instruments')}
      />
    );
  } else {
    screen = null; // '/' during redirect
  }

  const showTabBar =
    !currentPage &&
    hasInstrument &&
    ((segments[0] === 'i' && segments.length === 2) ||
      pathname === '/records' ||
      pathname === '/me');

  const tabTrainTarget = isValidInstrument(activeInstrumentId)
    ? `/i/${activeInstrumentId}`
    : isValidInstrument(selected)
      ? `/i/${selected}`
      : '/instruments';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-hidden" key={pathname}>
        {screen}
      </div>

      {showTabBar && (
        <TabBar
          items={[
            {
              key: 'train',
              label: t('nav.train'),
              icon: GraduationCap,
              active: segments[0] === 'i',
              onClick: () => navTo(tabTrainTarget),
            },
            {
              key: 'records',
              label: t('nav.records'),
              icon: BarChart3,
              active: pathname === '/records',
              onClick: () => navTo('/records'),
            },
            {
              key: 'mine',
              label: t('nav.mine'),
              icon: User,
              active: pathname === '/me',
              onClick: () => navTo('/me'),
            },
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------------------

interface TabItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}

function TabBar({ items }: { items: TabItem[] }) {
  return (
    <nav className="shrink-0 border-t border-border/70 bg-[#0b101c]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-stretch px-2 pb-2 pt-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium transition-colors',
                item.active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
              )}
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={item.active ? 2.5 : 1.9} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Reusable top app bar (back + centered title + optional trailing)
// ---------------------------------------------------------------------------

function AppBar({
  title,
  onBack,
  trailing,
}: {
  title?: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative flex h-12 shrink-0 items-center px-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t('nav.back')}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/85 active:bg-accent"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
      )}
      {title && (
        <div className="pointer-events-none absolute inset-x-0 mx-auto max-w-[60%] truncate text-center text-base font-semibold text-foreground">
          {title}
        </div>
      )}
      <div className="ml-auto flex items-center">{trailing}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — Instrument picker
// ---------------------------------------------------------------------------

interface InstrumentPickerProps {
  instruments: InstrumentConfig[];
  selected: string | null;
  onSelect: (id: string) => void;
  onBack?: () => void;
}

function InstrumentPicker({ instruments, selected, onSelect, onBack }: InstrumentPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto">
      <header className="px-6 pb-5 pt-7">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('nav.back')}
            className="mb-3 -ml-2 flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 active:bg-accent"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
        )}
        <h1 className="flex items-center gap-2 text-[28px] font-bold tracking-tight text-foreground">
          {t('nav.pickInstrumentTitle')}
          <Music2 className="h-6 w-6 text-primary" strokeWidth={2.4} />
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{t('nav.pickInstrumentJourney')}</p>
      </header>

      <div className="space-y-4 px-5 pb-8">
        {instruments.map((inst) => {
          const Icon = inst.icon;
          const isCurrent = inst.id === selected;
          return (
            <button
              key={inst.id}
              type="button"
              onClick={() => onSelect(inst.id)}
              className={cn(
                'group relative flex h-36 w-full flex-col justify-end overflow-hidden rounded-[26px] border bg-card p-5 text-left shadow-lg transition-transform duration-150 active:scale-[0.99]',
                isCurrent ? 'border-primary/60' : 'border-white/10',
              )}
            >
              <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-30', inst.gradient)} />
              <div className={cn('pointer-events-none absolute -bottom-10 -right-8 h-44 w-44 rounded-full bg-gradient-to-br opacity-40 blur-2xl', inst.gradient)} />
              <Icon className="pointer-events-none absolute right-5 top-5 h-24 w-24 text-white/10" strokeWidth={1.5} />
              <div className="relative">
                <div className="text-2xl font-bold leading-tight text-white">{inst.title}</div>
                <div className="mt-0.5 text-sm text-white/45">{inst.en}</div>
                <span className="mt-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-white/5 text-white/85 backdrop-blur-sm">
                  <ChevronRightIcon className="h-4 w-4" />
                </span>
              </div>
            </button>
          );
        })}

        {/* Coming soon */}
        <div className="relative flex h-28 flex-col justify-center overflow-hidden rounded-[26px] border border-dashed border-border bg-card/60 p-5">
          <Sparkles className="pointer-events-none absolute right-6 top-1/2 h-16 w-16 -translate-y-1/2 text-white/10" strokeWidth={1.5} />
          <div className="text-lg font-semibold text-foreground/80">{t('nav.moreInstruments')}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{t('nav.moreInstrumentsDesc')}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — Module list
// ---------------------------------------------------------------------------

interface ModuleListProps {
  instrument: InstrumentConfig;
  onOpenModule: (mod: ModuleConfig) => void;
  onSwitch: () => void;
}

function ModuleList({ instrument, onOpenModule, onSwitch }: ModuleListProps) {
  const { t } = useTranslation();
  const Icon = instrument.icon;
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-3 pt-3">
        <button
          type="button"
          onClick={onSwitch}
          aria-label={t('nav.back')}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/85 active:bg-accent"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={onSwitch}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground/85 active:bg-accent"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {t('nav.switchInstrument')}
        </button>
      </div>

      <div className="relative px-6 pb-1 pt-2">
        <Icon className="pointer-events-none absolute -top-1 right-3 h-28 w-28 text-white/[0.06]" strokeWidth={1.25} />
        <h1 className="flex items-center gap-1.5 text-[30px] font-bold leading-tight tracking-tight text-foreground">
          {t('train.instrumentTraining', { name: instrument.title })}
          <ChevronDown className="h-6 w-6 text-muted-foreground" strokeWidth={2.2} />
        </h1>
        <p className="mt-2 max-w-[70%] text-sm text-muted-foreground">{t('train.selectModule')}</p>
      </div>

      <div className="space-y-3.5 px-5 pt-5">
        {instrument.modules.map((mod) => {
          const ModIcon = mod.icon;
          const accent = accentOf(mod.accent);
          const locked = mod.kind === 'locked';
          return (
            <button
              key={mod.id}
              type="button"
              disabled={locked}
              onClick={() => onOpenModule(mod)}
              className={cn(
                'relative flex w-full items-center gap-4 overflow-hidden rounded-3xl border p-4 text-left shadow-md transition-transform duration-150',
                locked ? 'border-border bg-card/50 opacity-60' : cn(accent.border, accent.glow, 'active:scale-[0.99]'),
              )}
            >
              <span
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg',
                  locked ? 'bg-muted' : cn('bg-gradient-to-br', accent.chip),
                )}
              >
                <ModIcon className="h-6 w-6" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-foreground">{mod.title}</div>
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{mod.subtitle}</div>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-muted-foreground">
                {locked ? <Lock className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-4 w-4" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-6 shrink-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decorative waveform (used by module hero + virtual instrument)
// ---------------------------------------------------------------------------

const WAVE_BARS = [8, 16, 26, 14, 32, 20, 40, 24, 46, 30, 46, 24, 40, 20, 32, 14, 26, 16, 8];

function Waveform({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-[3px]', className)}>
      {WAVE_BARS.map((h, i) => (
        <span
          key={i}
          className={cn('w-[3px] rounded-full', active ? 'bg-primary/80' : 'bg-primary/25')}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Module detail (lessons with progress / lock / test)
// ---------------------------------------------------------------------------

interface ModuleDetailProps {
  module: ModuleConfig;
  onBack: () => void;
  onOpenLesson: (path: string) => void;
}

function ModuleDetail({ module, onBack, onOpenLesson }: ModuleDetailProps) {
  const { t } = useTranslation();
  const HeroIcon = module.icon;
  const lessons = module.lessons ?? [];

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto">
      <AppBar title={module.title} onBack={onBack} />

      {/* Glowing circular hero with flanking waveform */}
      <div className="relative flex flex-col items-center px-6 pb-6 pt-2">
        <div className="relative flex h-32 w-full items-center justify-center">
          <Waveform className="absolute inset-x-6 opacity-70" />
          <div className="pointer-events-none absolute h-28 w-28 rounded-full bg-primary/25 blur-2xl" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_0_45px_rgba(59,130,246,0.55)] ring-4 ring-white/5">
            <HeroIcon className="h-11 w-11 text-white" strokeWidth={2} />
          </div>
        </div>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {module.heroDesc ?? module.subtitle}
        </p>
      </div>

      {/* Lessons */}
      <div className="space-y-2.5 px-5 pb-8">
        {lessons.map((lesson, idx) => {
          const LessonIcon = lesson.icon;
          const accent = accentOf(idx);

          // "Start test" CTA card
          if (lesson.test) {
            return (
              <button
                key={lesson.id}
                type="button"
                onClick={() => lesson.path && onOpenLesson(lesson.path)}
                className="mt-2 flex w-full items-center gap-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-blue-500/15 to-indigo-600/15 p-4 text-left shadow-md transition-transform duration-150 active:scale-[0.99]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                  <Sparkles className="h-6 w-6" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-foreground">{lesson.title}</div>
                  <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{lesson.subtitle}</div>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ChevronRightIcon className="h-4 w-4" />
                </span>
              </button>
            );
          }

          const locked = lesson.locked || !lesson.path;
          const pct = lesson.progress
            ? Math.round((lesson.progress.done / lesson.progress.total) * 100)
            : 0;

          return (
            <button
              key={lesson.id}
              type="button"
              disabled={locked}
              onClick={() => lesson.path && onOpenLesson(lesson.path)}
              className={cn(
                'flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-transform duration-150',
                locked ? 'opacity-55' : 'active:scale-[0.99]',
              )}
            >
              <span
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow',
                  locked ? 'bg-muted' : cn('bg-gradient-to-br', accent.chip),
                )}
              >
                <LessonIcon className="h-[22px] w-[22px]" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-foreground">{lesson.title}</div>
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{lesson.subtitle}</div>
                {lesson.progress && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn('h-full rounded-full', accent.bar)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex w-10 shrink-0 justify-end">
                {locked ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : lesson.progress ? (
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {lesson.progress.done}/{lesson.progress.total}
                  </span>
                ) : (
                  <ChevronRightIcon className="h-4 w-4 text-muted-foreground/60" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — Virtual instrument (playable piano + metronome + recorder UI)
// ---------------------------------------------------------------------------

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function playMetronomeClick(ac: AudioContext) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = 1200;
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.05);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.06);
}

const RECORD_TOTAL_SEC = 30;

function VirtualInstrument({ module, onBack }: { module: ModuleConfig; onBack: () => void }) {
  const { t } = useTranslation();
  const { playNote } = useAudio();

  const [activeNote, setActiveNote] = useState<string | undefined>(undefined);
  const [metroOn, setMetroOn] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);

  const acRef = useRef<AudioContext | null>(null);
  const clearActiveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKey = useCallback(
    (_pc: string, note: string) => {
      void playNote(note, 1.5);
      setActiveNote(note);
      if (clearActiveRef.current) clearTimeout(clearActiveRef.current);
      clearActiveRef.current = setTimeout(() => setActiveNote(undefined), 220);
    },
    [playNote],
  );

  // Metronome
  useEffect(() => {
    if (!metroOn) return;
    const ac = (acRef.current ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
    void ac.resume();
    playMetronomeClick(ac);
    const id = setInterval(() => playMetronomeClick(ac), 60000 / bpm);
    return () => clearInterval(id);
  }, [metroOn, bpm]);

  // Recording timer
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= RECORD_TOTAL_SEC) {
          setRecording(false);
          return RECORD_TOTAL_SEC;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      if (clearActiveRef.current) clearTimeout(clearActiveRef.current);
      acRef.current?.close().catch(() => undefined);
    };
  }, []);

  const toggleRecord = useCallback(() => {
    setRecording((r) => {
      if (!r) setElapsed(0);
      return !r;
    });
  }, []);

  const playDemo = useCallback(() => {
    const seq = ['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4'];
    setPlaying(true);
    seq.forEach((n, i) => setTimeout(() => void playNote(n, 0.6), i * 260));
    setTimeout(() => setPlaying(false), seq.length * 260 + 200);
  }, [playNote]);

  const tools = [
    {
      key: 'record',
      label: t('train.viRecord'),
      icon: Mic,
      active: recording,
      onClick: toggleRecord,
    },
    {
      key: 'metronome',
      label: `${t('train.viMetronome')} ♩=${bpm}`,
      icon: Activity,
      active: metroOn,
      onClick: () => setMetroOn((m) => !m),
    },
    { key: 'timbre', label: t('train.viTimbre'), icon: SlidersHorizontal, active: false, onClick: () => setBpm((b) => (b >= 160 ? 60 : b + 20)) },
    { key: 'settings', label: t('train.viSettings'), icon: Settings, active: false, onClick: () => setMetroOn(false) },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden">
      <AppBar
        title={module.title}
        onBack={onBack}
        trailing={
          <button
            type="button"
            aria-label={t('train.viSettings')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 active:bg-accent"
          >
            <Settings className="h-5 w-5" />
          </button>
        }
      />

      {/* Instrument selector pill */}
      <div className="flex justify-center pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
          <span className="text-base">🎹</span>
          {t('train.viGrandPiano')}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Piano */}
      <div className="flex flex-1 flex-col justify-center px-3">
        <PianoKeyboard
          onKeyPress={handleKey}
          activeNote={activeNote}
          noteRange={{ min: 'C4', max: 'C5' }}
          showNoteLabels={false}
          showRuler={false}
          fillWidth
          maxHeight={230}
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">{t('train.viTapHint')}</p>
      </div>

      {/* Tool row */}
      <div className="flex items-stretch justify-around border-t border-border/60 px-2 py-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.key}
              type="button"
              onClick={tool.onClick}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium transition-colors',
                tool.active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="whitespace-nowrap">{tool.label}</span>
            </button>
          );
        })}
      </div>

      {/* Waveform + timeline */}
      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <Waveform active={recording || playing} className="h-12" />
          <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{fmtTime(elapsed)}</span>
            <span>{fmtTime(RECORD_TOTAL_SEC)}</span>
          </div>
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-8 py-5 pb-6">
        <button
          type="button"
          onClick={() => setElapsed(0)}
          aria-label="restart"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground/80 active:bg-accent"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={playDemo}
          aria-label="play"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_8px_24px_rgba(59,130,246,0.45)] active:scale-95"
        >
          <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={() => {
            setRecording(false);
            setPlaying(false);
            setMetroOn(false);
          }}
          aria-label="stop"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground/80 active:bg-accent"
        >
          <Square className="h-5 w-5" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records — placeholder (tab: 练习记录)
// ---------------------------------------------------------------------------

function RecordsScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto">
      <header className="px-6 pb-2 pt-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('nav.records')}</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 ring-1 ring-primary/20">
          <BarChart3 className="h-9 w-9 text-primary" strokeWidth={1.8} />
        </div>
        <div className="mt-5 text-lg font-semibold text-foreground">{t('nav.recordsEmptyTitle')}</div>
        <div className="mt-1.5 max-w-xs text-sm text-muted-foreground">{t('nav.recordsEmptyDesc')}</div>
        <span className="mt-4 rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
          {t('nav.comingSoon')}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mine — settings (tab: 我的)
// ---------------------------------------------------------------------------

function MineScreen({ onSwitchInstrument }: { onSwitchInstrument: () => void }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<SupportedLocale>(
    (i18n.resolvedLanguage as SupportedLocale) ?? 'zh-CN',
  );
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handler = (value: string) => setLocale((value as SupportedLocale) ?? 'zh-CN');
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);

  const handleLocaleChange = useCallback((val: SupportedLocale) => {
    setLocale(val);
    i18n.changeLanguage(val);
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    try {
      if (!('serviceWorker' in navigator)) {
        message.info(t('pwa.upToDate'));
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        message.info(t('pwa.upToDate'));
        return;
      }
      await reg.update();
      await new Promise((r) => setTimeout(r, 1000));
      message.success(t('pwa.upToDate'));
    } catch {
      message.info(t('pwa.upToDate'));
    } finally {
      setChecking(false);
    }
  }, [t]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto">
      <header className="px-6 pb-4 pt-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('nav.mine')}</h1>
      </header>

      <div className="space-y-3 px-5">
        <button
          type="button"
          onClick={onSwitchInstrument}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm active:bg-accent"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <span className="flex-1 text-[15px] font-medium text-foreground">
            {t('nav.switchInstrument')}
          </span>
          <ChevronRightIcon className="h-5 w-5 text-muted-foreground/60" />
        </button>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 text-sm font-medium text-foreground">{t('lang.switchLang')}</div>
          <Select
            value={locale}
            onChange={handleLocaleChange}
            options={supportedLocales.map((l) => ({ value: l.key, label: l.label }))}
          />
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div>
            <div className="text-sm font-medium text-foreground">{t('nav.version')}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">v{__APP_VERSION__}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={checking}
            onClick={handleCheckUpdate}
            icon={!checking ? <ReloadOutlined className="h-4 w-4" /> : undefined}
          >
            {t('pwa.checkUpdate')}
          </Button>
        </div>
      </div>

      <div className="h-6 shrink-0" />
    </div>
  );
}

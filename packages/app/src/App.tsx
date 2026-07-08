import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { start } from 'tauri-plugin-keepawake-api';
import { Toaster, TooltipProvider } from '@ezmusic/shared';
import {
  Piano,
  Guitar,
  Music4,
  Music2,
  Activity,
  Gauge,
  Ruler,
  BookOpen,
  Mic,
  MapPin,
  Sparkles,
  Eye,
} from 'lucide-react';
import AppShell from './components/AppShell';
import type { InstrumentConfig, PageConfig } from './components/AppShell';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import Tuner from './components/Tuner';
import SightSinging from './components/SightSinging';
import SightSinging2 from './components/SightSinging2';
import FretboardMemorization from './components/FretboardMemorization';
import FretboardMemorization2 from './components/FretboardMemorization2';
import SightReading from './components/SightReading';
import { NoteSolfegeIntervalDrill } from '@ezmusic/chapter-note-solfege';
import { DrillSession, StaffIntervalDrill } from '@ezmusic/chapter-staff-notation';
// Initialize i18n
import '@ezmusic/shared';

export default function App() {
  const { t } = useTranslation();

  // Keep screen/system awake while app is running
  useEffect(() => {
    start({ display: true, idle: true, sleep: true }).catch(() => {
      // Silently fail if keepawake is not available (e.g., running as PWA)
    });
  }, []);

  // Drill route registry — path → real drill component.
  const pages: PageConfig[] = [
    { path: '/tuner', title: t('tuner.title'), page: () => <Tuner /> },
    { path: '/sight-singing', title: t('sightSinging.title'), page: () => <SightSinging /> },
    { path: '/sight-singing2', title: t('sightSinging2.title'), page: () => <SightSinging2 /> },
    { path: '/fretboard-memorization', title: t('fretboardMemo.title'), page: () => <FretboardMemorization /> },
    { path: '/fretboard-memorization2', title: t('fretboardMemo2.title'), page: () => <FretboardMemorization2 /> },
    { path: '/sight-reading', title: t('sightReading.title'), page: () => <SightReading /> },
    { path: '/interval-speed-drill', title: t('noteSolfege.intervalSpeedDrill'), page: () => <NoteSolfegeIntervalDrill /> },
    { path: '/note-reading-drill', title: t('staffNotation.drillTitle'), page: () => <DrillSession /> },
    { path: '/interval-drill', title: t('staffNotation.intervalDrillTitle'), page: () => <StaffIntervalDrill /> },
  ];

  // Instrument → module → lesson content tree.
  const instruments: InstrumentConfig[] = [
    {
      id: 'piano',
      title: t('train.instPiano'),
      en: 'Piano',
      subtitle: '识谱 · 演奏 · 视奏',
      icon: Piano,
      gradient: 'from-slate-500 to-slate-800',
      modules: [
        {
          id: 'reading',
          title: t('train.modReading'),
          subtitle: t('train.modReadingDesc'),
          heroDesc: t('train.heroReadingDesc'),
          icon: Music2,
          accent: 0,
          kind: 'lessons',
          lessons: [
            { id: 'theory', title: t('train.lesTheory'), subtitle: t('train.lesTheoryDesc'), icon: BookOpen, path: '/note-reading-drill', progress: { done: 6, total: 12 } },
            { id: 'interval', title: t('train.lesInterval'), subtitle: t('train.lesIntervalDesc'), icon: Ruler, path: '/interval-drill', progress: { done: 8, total: 15 } },
            { id: 'solfege', title: t('train.lesSolfege'), subtitle: t('train.lesSolfegeDesc'), icon: Mic, path: '/sight-singing', progress: { done: 5, total: 10 } },
            { id: 'rhythm', title: t('train.lesRhythm'), subtitle: t('train.lesRhythmDesc'), icon: Activity, locked: true },
            { id: 'test', title: t('train.startTest'), subtitle: t('train.lesTestDesc'), icon: Sparkles, path: '/interval-speed-drill', test: true },
          ],
        },
        {
          id: 'virtual',
          title: t('train.modVirtual'),
          subtitle: t('train.modVirtualDesc'),
          icon: Piano,
          accent: 1,
          kind: 'virtual',
        },
        {
          id: 'sightread',
          title: t('train.modSightread'),
          subtitle: t('train.modSightreadDesc'),
          icon: Activity,
          accent: 2,
          kind: 'drill',
          path: '/interval-speed-drill',
        },
      ],
    },
    {
      id: 'guitar',
      title: t('train.instGuitar'),
      en: 'Guitar',
      subtitle: '指板 · 视奏 · 调音',
      icon: Guitar,
      gradient: 'from-amber-500 to-orange-700',
      modules: [
        {
          id: 'fretboard',
          title: t('train.modFretboard'),
          subtitle: t('train.modFretboardDesc'),
          heroDesc: t('train.heroFretboardDesc'),
          icon: Guitar,
          accent: 0,
          kind: 'lessons',
          lessons: [
            { id: 'fret1', title: t('train.lesFret1'), subtitle: t('train.lesFret1Desc'), icon: Guitar, path: '/fretboard-memorization', progress: { done: 4, total: 12 } },
            { id: 'fret2', title: t('train.lesFret2'), subtitle: t('train.lesFret2Desc'), icon: MapPin, path: '/fretboard-memorization2', progress: { done: 2, total: 12 } },
            { id: 'test', title: t('train.startTest'), subtitle: t('train.lesTestDesc'), icon: Sparkles, path: '/sight-reading', test: true },
          ],
        },
        {
          id: 'sightread',
          title: t('train.modSightread'),
          subtitle: t('train.modSightreadDesc'),
          icon: Eye,
          accent: 2,
          kind: 'drill',
          path: '/sight-reading',
        },
        {
          id: 'tuner',
          title: t('train.modTuner'),
          subtitle: t('train.modTunerDesc'),
          icon: Gauge,
          accent: 1,
          kind: 'drill',
          path: '/tuner',
        },
      ],
    },
    {
      id: 'violin',
      title: t('train.instViolin'),
      en: 'Violin',
      subtitle: '识谱 · 音准 · 音程',
      icon: Music4,
      gradient: 'from-rose-500 to-red-700',
      modules: [
        {
          id: 'reading',
          title: t('train.modReading'),
          subtitle: t('train.modReadingDesc'),
          heroDesc: t('train.heroReadingDesc'),
          icon: Music2,
          accent: 0,
          kind: 'lessons',
          lessons: [
            { id: 'theory', title: t('train.lesTheory'), subtitle: t('train.lesTheoryDesc'), icon: BookOpen, path: '/note-reading-drill', progress: { done: 3, total: 12 } },
            { id: 'interval', title: t('train.lesInterval'), subtitle: t('train.lesIntervalDesc'), icon: Ruler, path: '/interval-drill', progress: { done: 1, total: 15 } },
            { id: 'solfege', title: t('train.lesSolfege'), subtitle: t('train.lesSolfegeDesc'), icon: Mic, path: '/sight-singing' },
            { id: 'test', title: t('train.startTest'), subtitle: t('train.lesTestDesc'), icon: Sparkles, path: '/interval-speed-drill', test: true },
          ],
        },
        {
          id: 'sightread',
          title: t('train.modSightread'),
          subtitle: t('train.modSightreadDesc'),
          icon: Activity,
          accent: 2,
          kind: 'locked',
        },
      ],
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <AppShell pages={pages} instruments={instruments} />
      <PwaUpdatePrompt />
      <Toaster />
    </TooltipProvider>
  );
}

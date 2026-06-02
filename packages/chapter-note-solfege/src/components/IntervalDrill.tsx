/**
 * Interval Speed Drill — note-name based semitone counting quiz.
 *
 * Two random note names are shown. The user counts the semitones between them.
 * Features: localStorage persistence, range slider, accidentals toggle,
 * auto-upgrade on 90% accuracy over last 20 answers, auto-play on generation.
 */
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Card,
  Grid,
  Popconfirm,
  Progress,
  Slider,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SoundOutlined, TrophyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAudio } from '@ezmusic/shared';

const { Paragraph, Text } = Typography;
const { useBreakpoint } = Grid;

const STORAGE_KEY = 'ezmusic-note-solfege-interval-drill';
const SEMITONE_MIN = 1;
const SEMITONE_MAX = 12;
const DEFAULT_RANGE: [number, number] = [1, 3];
const NOTE_PLAY_DURATION = 0.8;
const NOTE_GAP_MS = 120;

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURAL_PITCH_CLASSES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** MIDI ranges covering C3–B5 (3 octaves) — good coverage for note-name practice */
const NOTE_RANGES: Record<'low' | 'high', { min: number; max: number }> = {
  low: { min: 48, max: 65 },   // C3–F5
  high: { min: 60, max: 83 },  // C4–B5
};

const SLIDER_MARKS = Object.fromEntries(
  Array.from({ length: SEMITONE_MAX }, (_, index) => {
    const value = index + 1;
    return [value, String(value)];
  }),
);

interface IntervalDrillStore {
  range: [number, number];
  allowAccidentals: boolean;
  recentResults: boolean[];
  totalCorrect: number;
  totalAttempts: number;
}

interface IntervalQuestion {
  semitones: number;
  notes: [string, string];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clampSemitone(value: number): number {
  return Math.min(SEMITONE_MAX, Math.max(SEMITONE_MIN, Math.round(value)));
}

function normalizeRange(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === 'number')) {
    return DEFAULT_RANGE;
  }
  const low = clampSemitone(Math.min(value[0], value[1]));
  const high = clampSemitone(Math.max(value[0], value[1]));
  return [low, high];
}

function emptyStore(): IntervalDrillStore {
  return {
    range: DEFAULT_RANGE,
    allowAccidentals: false,
    recentResults: [],
    totalCorrect: 0,
    totalAttempts: 0,
  };
}

function loadStore(): IntervalDrillStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IntervalDrillStore>;
      return {
        range: normalizeRange(parsed.range),
        allowAccidentals: parsed.allowAccidentals === true,
        recentResults: Array.isArray(parsed.recentResults)
          ? parsed.recentResults.filter((item): item is boolean => typeof item === 'boolean').slice(-20)
          : [],
        totalCorrect: typeof parsed.totalCorrect === 'number' ? parsed.totalCorrect : 0,
        totalAttempts: typeof parsed.totalAttempts === 'number' ? parsed.totalAttempts : 0,
      };
    }
  } catch { /* ignore */ }

  return emptyStore();
}

function saveStore(store: IntervalDrillStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function midiToNote(midi: number): string {
  const pitchClass = PITCH_CLASSES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitchClass}${octave}`;
}

function isNaturalMidi(midi: number): boolean {
  return NATURAL_PITCH_CLASSES.has(PITCH_CLASSES[midi % 12]);
}

function makeQuestion(range: [number, number], allowAccidentals: boolean): IntervalQuestion {
  const semitones = randomInt(range[0], range[1]);

  // Build candidate pairs across both ranges
  const allRanges = (Object.values(NOTE_RANGES) as Array<{ min: number; max: number }>);
  const candidates = allRanges.flatMap((midiRange) => {
    const pairs: Array<{ lowerMidi: number; upperMidi: number }> = [];
    for (let lowerMidi = midiRange.min; lowerMidi <= midiRange.max - semitones; lowerMidi += 1) {
      const upperMidi = lowerMidi + semitones;
      if (!allowAccidentals && (!isNaturalMidi(lowerMidi) || !isNaturalMidi(upperMidi))) {
        continue;
      }
      pairs.push({ lowerMidi, upperMidi });
    }
    return pairs;
  });

  // Fallback: ignore accidental filter if no natural-only candidates exist
  const pool = candidates.length > 0
    ? candidates
    : allRanges.flatMap((midiRange) =>
      Array.from({ length: midiRange.max - midiRange.min - semitones + 1 }, (_, index) => ({
        lowerMidi: midiRange.min + index,
        upperMidi: midiRange.min + index + semitones,
      })),
    );

  const { lowerMidi, upperMidi } = pool[randomInt(0, pool.length - 1)];
  const ascending = Math.random() >= 0.5;

  return {
    semitones,
    notes: ascending
      ? [midiToNote(lowerMidi), midiToNote(upperMidi)]
      : [midiToNote(upperMidi), midiToNote(lowerMidi)],
  };
}

function buildOptions(range: [number, number]): number[] {
  return Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index);
}

function applyAnswerResult(store: IntervalDrillStore, isCorrect: boolean): {
  nextStore: IntervalDrillStore;
  promotedRange: [number, number] | null;
} {
  const recentResults = [...store.recentResults, isCorrect].slice(-20);
  const totalAttempts = store.totalAttempts + 1;
  const totalCorrect = store.totalCorrect + (isCorrect ? 1 : 0);

  if (recentResults.length === 20) {
    const correctCount = recentResults.filter(Boolean).length;
    if (correctCount >= 18 && store.range[1] < SEMITONE_MAX) {
      const promotedRange: [number, number] = [store.range[0], store.range[1] + 1];
      return {
        nextStore: {
          range: promotedRange,
          allowAccidentals: store.allowAccidentals,
          recentResults: [],
          totalAttempts,
          totalCorrect,
        },
        promotedRange,
      };
    }
  }

  return {
    nextStore: {
      ...store,
      recentResults,
      totalAttempts,
      totalCorrect,
    },
    promotedRange: null,
  };
}

/** Purple gradient note-name display box */
function NoteNameBox({ note }: { note: string }) {
  const pc = note.replace(/\d/, '');
  const octave = note.replace(/[^0-9]/g, '');
  return (
    <div
      style={{
        width: 80,
        height: 80,
        borderRadius: 16,
        flexShrink: 0,
        background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(124,58,237,0.28)',
      }}
    >
      <span style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{pc}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1, marginTop: 2 }}>{octave}</span>
    </div>
  );
}

export default function IntervalDrill() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const { playNote } = useAudio();
  const initialStore = useMemo(loadStore, []);

  const [store, setStore] = useState<IntervalDrillStore>(initialStore);
  const [question, setQuestion] = useState<IntervalQuestion>(() =>
    makeQuestion(initialStore.range, initialStore.allowAccidentals),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [lastPromotion, setLastPromotion] = useState<[number, number] | null>(null);
  const playbackIdRef = useRef(0);

  const options = useMemo(() => {
    const all = buildOptions(store.range);
    if (all.length <= 4) return all;
    // Keep the correct answer, fill the rest with random picks
    const correct = question.semitones;
    const others = all.filter((v) => v !== correct);
    // Fisher-Yates shuffle on others, then take 3
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const picked = [correct, ...others.slice(0, 3)];
    // Shuffle again so the correct answer isn't always first
    for (let i = picked.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    return picked;
  }, [store.range, question.semitones]);
  const recentCorrect = useMemo(
    () => store.recentResults.filter(Boolean).length,
    [store.recentResults],
  );
  const recentAccuracy = store.recentResults.length > 0
    ? Math.round((recentCorrect / store.recentResults.length) * 100)
    : null;
  const totalAccuracy = store.totalAttempts > 0
    ? Math.round((store.totalCorrect / store.totalAttempts) * 100)
    : null;

  const replayQuestion = useCallback(() => {
    playbackIdRef.current += 1;
    const playbackId = playbackIdRef.current;

    void (async () => {
      for (let index = 0; index < question.notes.length; index += 1) {
        if (playbackId !== playbackIdRef.current) return;
        await playNote(question.notes[index], NOTE_PLAY_DURATION);
        if (index < question.notes.length - 1) {
          await wait(NOTE_PLAY_DURATION * 1000 + NOTE_GAP_MS);
        }
      }
    })();
  }, [playNote, question.notes]);

  // Persist store
  useEffect(() => {
    saveStore(store);
  }, [store]);

  // Auto-play on new question
  useEffect(() => {
    replayQuestion();
  }, [replayQuestion]);

  const handleRangeChange = useCallback((value: number | number[]) => {
    if (!Array.isArray(value) || value.length !== 2) return;

    const nextRange = normalizeRange([value[0], value[1]]);
    const nextStore: IntervalDrillStore = {
      ...store,
      range: nextRange,
      recentResults: [],
    };

    setStore(nextStore);
    setQuestion(makeQuestion(nextRange, store.allowAccidentals));
    setSelected(null);
    setLastPromotion(null);
  }, [store]);

  const handleAccidentalToggle = useCallback((checked: boolean) => {
    const nextStore: IntervalDrillStore = {
      ...store,
      allowAccidentals: checked,
      recentResults: [],
    };

    setStore(nextStore);
    setQuestion(makeQuestion(nextStore.range, nextStore.allowAccidentals));
    setSelected(null);
    setLastPromotion(null);
  }, [store]);

  const handleAnswer = useCallback((value: number) => {
    if (selected !== null) return;

    setSelected(value);
    const result = applyAnswerResult(store, value === question.semitones);
    setStore(result.nextStore);
    setLastPromotion(result.promotedRange);
  }, [question.semitones, selected, store]);

  const handleNext = useCallback(() => {
    setQuestion(makeQuestion(store.range, store.allowAccidentals));
    setSelected(null);
  }, [store.allowAccidentals, store.range]);

  const handleReset = useCallback(() => {
    const nextStore = emptyStore();
    setStore(nextStore);
    setQuestion(makeQuestion(nextStore.range, nextStore.allowAccidentals));
    setSelected(null);
    setLastPromotion(null);
  }, []);

  return (
    <Card
      title={
        <Space>
          <span style={{ fontSize: 18 }}>⚡</span>
          <span style={{ fontWeight: 600 }}>{t('noteSolfege.intervalSpeedDrill')}</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        {t('noteSolfege.intervalSpeedDrillHint')}
      </Paragraph>

      {/* Stats row */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="geekblue">
          {t('noteSolfege.intervalSpeedDrillRangeValue', { min: store.range[0], max: store.range[1] })}
        </Tag>
        {totalAccuracy !== null && (
          <Tag icon={<TrophyOutlined />} color="gold">
            {t('noteSolfege.intervalSpeedDrillAccuracy')} {totalAccuracy}%
          </Tag>
        )}
        <Progress
          percent={Math.round((store.range[1] / SEMITONE_MAX) * 100)}
          size="small"
          strokeColor="#7c3aed"
          format={() => t('noteSolfege.intervalSpeedDrillRangeProgress', { max: store.range[1] })}
          style={{ width: 220 }}
        />
      </Space>

      {/* Note display area */}
      <div
        role="button"
        tabIndex={0}
        onClick={replayQuestion}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            replayQuestion();
          }
        }}
        style={{
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 12,
          padding: '24px 12px',
          textAlign: 'center',
          marginBottom: 20,
          cursor: 'pointer',
        }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('noteSolfege.intervalSpeedDrillQuestionPrompt')}
          </Text>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: screens.xs ? 20 : 32,
              flexWrap: 'wrap',
            }}
          >
            <NoteNameBox note={question.notes[0]} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, color: '#c4b5fd', lineHeight: 1, marginBottom: 4 }}>↔</div>
            </div>
            <NoteNameBox note={question.notes[1]} />
          </div>
          <Button type="text" icon={<SoundOutlined />} onClick={(event) => {
            event.stopPropagation();
            replayQuestion();
          }}>
            {t('noteSolfege.intervalSpeedDrillReplay')}
          </Button>
        </Space>
      </div>

      {/* Controls row */}
      <div style={{ marginBottom: 12 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text strong>{t('noteSolfege.intervalSpeedDrillRangeLabel')}</Text>
          <Space size={8} wrap>
            <Text type="secondary">{t('noteSolfege.intervalSpeedDrillAccidentalsLabel')}</Text>
            <Switch
              checked={store.allowAccidentals}
              onChange={handleAccidentalToggle}
              checkedChildren={t('noteSolfege.intervalSpeedDrillAccidentalsOn')}
              unCheckedChildren={t('noteSolfege.intervalSpeedDrillAccidentalsOff')}
            />
          </Space>
          <Popconfirm
            title={t('noteSolfege.intervalSpeedDrillResetProgress')}
            onConfirm={handleReset}
            okText="OK"
            cancelText={t('nav.close')}
          >
            <Button size="small" icon={<ReloadOutlined />} danger>
              {t('noteSolfege.intervalSpeedDrillResetProgress')}
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* Range slider */}
      <Slider
        range
        min={SEMITONE_MIN}
        max={SEMITONE_MAX}
        step={1}
        marks={SLIDER_MARKS}
        value={store.range}
        onChange={handleRangeChange}
        styles={{
          track: { background: 'linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)' },
          rail: { background: '#ede9fe' },
          handle: { borderColor: '#7c3aed' },
        }}
      />

      {/* Auto-upgrade status */}
      <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('noteSolfege.intervalSpeedDrillAutoUpgradeHint')}
        </Text>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('noteSolfege.intervalSpeedDrillWindowStatus', {
            correct: recentCorrect,
            total: store.recentResults.length,
            accuracy: recentAccuracy ?? 0,
          })}
        </Text>
        {lastPromotion !== null && (
          <Tag color="success">
            {t('noteSolfege.intervalSpeedDrillPromotionReached', { min: lastPromotion[0], max: lastPromotion[1] })}
          </Tag>
        )}
      </Space>

      {/* Answer options grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
          gap: 10,
          marginBottom: selected !== null ? 16 : 0,
        }}
      >
        {options.map((option) => {
          const isCorrect = option === question.semitones;
          const isSelected = option === selected;
          let background = '#f5f3ff';
          let borderColor = '#c4b5fd';
          let color = '#5b21b6';

          if (selected !== null) {
            if (isCorrect) {
              background = '#d1fae5';
              borderColor = '#34d399';
              color = '#065f46';
            } else if (isSelected) {
              background = '#fee2e2';
              borderColor = '#f87171';
              color = '#991b1b';
            } else {
              background = '#f5f5f5';
              borderColor = '#d9d9d9';
              color = '#8c8c8c';
            }
          }

          return (
            <button
              key={option}
              type="button"
              onClick={() => handleAnswer(option)}
              style={{
                padding: '14px 0',
                borderRadius: 12,
                border: `2px solid ${borderColor}`,
                background,
                color,
                fontSize: 22,
                fontWeight: 700,
                cursor: selected === null ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }}
              disabled={selected !== null}
            >
              {option}
            </button>
          );
        })}
      </div>

      {/* Feedback + next */}
      {selected !== null && (
        <Space direction="vertical" size={12} style={{ width: '100%', alignItems: 'center' }}>
          <Tag
            color={selected === question.semitones ? 'success' : 'error'}
            style={{ fontSize: 14, padding: '6px 16px', borderRadius: 8 }}
          >
            {selected === question.semitones
              ? `✓ ${t('noteSolfege.intervalSpeedDrillCorrect')}`
              : `✗ ${t('noteSolfege.intervalSpeedDrillWrongAnswer', { answer: question.semitones })}`}
          </Tag>
          <Button type="primary" size="large" onClick={handleNext}>
            {t('noteSolfege.intervalSpeedDrillNextQuestion')} →
          </Button>
        </Space>
      )}
    </Card>
  );
}

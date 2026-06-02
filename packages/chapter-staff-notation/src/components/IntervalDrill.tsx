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

import StaffDisplay from './StaffDisplay';

const { Paragraph, Text } = Typography;
const { useBreakpoint } = Grid;

const STORAGE_KEY = 'ezmusic-staff-interval-drill';
const SEMITONE_MIN = 1;
const SEMITONE_MAX = 12;
const DEFAULT_RANGE: [number, number] = [1, 3];
const NOTE_PLAY_DURATION = 0.8;
const NOTE_GAP_MS = 120;

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURAL_PITCH_CLASSES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

const CLEF_RANGES: Record<'treble' | 'bass', { min: number; max: number }> = {
  treble: { min: 60, max: 77 },
  bass: { min: 40, max: 59 },
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
  clef: 'treble' | 'bass';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clampSemitone(value: number): number {
  return Math.min(SEMITONE_MAX, Math.max(SEMITONE_MIN, Math.round(value)));
}

function isRangeValue(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number');
}

function normalizeRange(value: unknown): [number, number] {
  if (!isRangeValue(value)) return DEFAULT_RANGE;
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
  } catch { }

  return emptyStore();
}

function saveStore(store: IntervalDrillStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { }
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
  const candidates = (Object.entries(CLEF_RANGES) as Array<[
    'treble' | 'bass',
    { min: number; max: number },
  ]>).flatMap(([clef, midiRange]) => {
    const pairs: Array<{ clef: 'treble' | 'bass'; lowerMidi: number; upperMidi: number }> = [];

    for (let lowerMidi = midiRange.min; lowerMidi <= midiRange.max - semitones; lowerMidi += 1) {
      const upperMidi = lowerMidi + semitones;
      if (!allowAccidentals && (!isNaturalMidi(lowerMidi) || !isNaturalMidi(upperMidi))) {
        continue;
      }
      pairs.push({ clef, lowerMidi, upperMidi });
    }

    return pairs;
  });

  const fallbackCandidates = candidates.length > 0
    ? candidates
    : (Object.entries(CLEF_RANGES) as Array<[
      'treble' | 'bass',
      { min: number; max: number },
    ]>).flatMap(([clef, midiRange]) => Array.from(
      { length: midiRange.max - midiRange.min - semitones + 1 },
      (_, index) => ({
        clef,
        lowerMidi: midiRange.min + index,
        upperMidi: midiRange.min + index + semitones,
      }),
    ));

  const { clef, lowerMidi, upperMidi } = fallbackCandidates[randomInt(0, fallbackCandidates.length - 1)];
  const ascending = Math.random() >= 0.5;

  return {
    semitones,
    clef,
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

export default function IntervalDrill() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const { playNote } = useAudio();
  const initialStore = useMemo(loadStore, []);

  const [store, setStore] = useState<IntervalDrillStore>(initialStore);
  const [question, setQuestion] = useState<IntervalQuestion>(() => makeQuestion(initialStore.range, initialStore.allowAccidentals));
  const [selected, setSelected] = useState<number | null>(null);
  const [lastPromotion, setLastPromotion] = useState<[number, number] | null>(null);
  const playbackIdRef = useRef(0);

  const options = useMemo(() => buildOptions(store.range), [store.range]);
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

  useEffect(() => {
    saveStore(store);
  }, [store]);

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
      title={(
        <Space>
          <span style={{ fontSize: 18 }}>🎯</span>
          <span style={{ fontWeight: 600 }}>{t('staffNotation.intervalDrillTitle')}</span>
        </Space>
      )}
      style={{ marginBottom: 24 }}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        {t('staffNotation.intervalDrillHint')}
      </Paragraph>

      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="geekblue">{t('staffNotation.intervalRangeValue', { min: store.range[0], max: store.range[1] })}</Tag>
        {totalAccuracy !== null && (
          <Tag icon={<TrophyOutlined />} color="gold">
            {t('staffNotation.accuracy')} {totalAccuracy}%
          </Tag>
        )}
        <Progress
          percent={Math.round((store.range[1] / SEMITONE_MAX) * 100)}
          size="small"
          strokeColor="#2563eb"
          format={() => t('staffNotation.intervalRangeProgress', { max: store.range[1] })}
          style={{ width: 220 }}
        />
      </Space>

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
          padding: '16px 12px',
          textAlign: 'center',
          marginBottom: 20,
          cursor: 'pointer',
        }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('staffNotation.intervalQuestionPrompt')}
          </Text>
          <StaffDisplay
            notes={question.notes}
            clef={question.clef}
            noteDuration="h"
            width={screens.xl ? 520 : screens.lg ? 440 : screens.md ? 360 : 280}
            height={190}
          />
          <Button type="text" icon={<SoundOutlined />} onClick={(event) => {
            event.stopPropagation();
            replayQuestion();
          }}>
            {t('staffNotation.intervalReplay')}
          </Button>
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text strong>{t('staffNotation.intervalRangeLabel')}</Text>
          <Space size={8} wrap>
            <Text type="secondary">{t('staffNotation.intervalAccidentalsLabel')}</Text>
            <Switch
              checked={store.allowAccidentals}
              onChange={handleAccidentalToggle}
              checkedChildren={t('staffNotation.intervalAccidentalsOn')}
              unCheckedChildren={t('staffNotation.intervalAccidentalsOff')}
            />
          </Space>
          <Popconfirm
            title={t('staffNotation.resetProgress')}
            onConfirm={handleReset}
            okText="OK"
            cancelText={t('nav.close')}
          >
            <Button size="small" icon={<ReloadOutlined />} danger>
              {t('staffNotation.resetProgress')}
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Slider
        range
        min={SEMITONE_MIN}
        max={SEMITONE_MAX}
        step={1}
        marks={SLIDER_MARKS}
        value={store.range}
        onChange={handleRangeChange}
        styles={{
          track: { background: 'linear-gradient(90deg, #2563eb 0%, #0ea5e9 100%)' },
          rail: { background: '#dbeafe' },
          handle: { borderColor: '#2563eb' },
        }}
      />

      <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('staffNotation.intervalAutoUpgradeHint')}
        </Text>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('staffNotation.intervalWindowStatus', {
            correct: recentCorrect,
            total: store.recentResults.length,
            accuracy: recentAccuracy ?? 0,
          })}
        </Text>
        {lastPromotion !== null && (
          <Tag color="success">{t('staffNotation.intervalPromotionReached', { min: lastPromotion[0], max: lastPromotion[1] })}</Tag>
        )}
      </Space>

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
          let background = '#eff6ff';
          let borderColor = '#93c5fd';
          let color = '#1d4ed8';

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

      {selected !== null && (
        <Space direction="vertical" size={12} style={{ width: '100%', alignItems: 'center' }}>
          <Tag
            color={selected === question.semitones ? 'success' : 'error'}
            style={{ fontSize: 14, padding: '6px 16px', borderRadius: 8 }}
          >
            {selected === question.semitones
              ? `✓ ${t('staffNotation.correct')}`
              : `✗ ${t('staffNotation.intervalWrongAnswer', { answer: question.semitones })}`}
          </Tag>
          <Button type="primary" size="large" onClick={handleNext}>
            {t('staffNotation.nextQuestion')} →
          </Button>
        </Space>
      )}
    </Card>
  );
}
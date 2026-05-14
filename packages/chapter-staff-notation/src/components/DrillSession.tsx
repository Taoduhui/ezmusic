/**
 * DrillSession — Anki-like progressive staff note reading drill.
 *
 * Stages:
 *   1. Treble · Single octave (C4–B4, 7 notes) — must master all to unlock next
 *   2. Treble · Two octaves  (C4–G5, 12 notes) — must master all to unlock next
 *   3. Treble · Free practice (extended treble range)
 *   4. Bass   · Free practice (bass clef range)
 *   5. Grand staff (combined treble + bass)
 *
 * Mastery rule: 3 consecutive correct answers per note.
 * Progress is persisted to localStorage.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Card, Button, Space, Typography, Progress, Tag, Badge,
  Divider, Row, Col, Tooltip, Popconfirm, Grid,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, ReloadOutlined,
  TrophyOutlined, LockOutlined, FireOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DRILL_STAGE_ORDER,
  DRILL_STAGE_NOTES,
  type DrillStage,
  type NoteProgress,
  selectDrillNote,
  getDrillDistractors,
  isStageComplete,
  shuffleArray,
  getClefForNote,
  useAudio,
} from '@ezmusic/shared';
import StaffDisplay from './StaffDisplay';

const { Title, Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

const STORAGE_KEY = 'ezmusic-staff-drill-progress';
const MASTERY_STREAK = 3;
const NOTE_PLAY_DURATION = 0.8;
const ANSWER_FEEDBACK_DELAY_MS = NOTE_PLAY_DURATION * 1000 + 150;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrillProgressStore {
  unlockedStages: DrillStage[];
  noteProgress: Record<string, NoteProgress>;
}

function emptyProgress(): DrillProgressStore {
  return {
    unlockedStages: ['treble-1oct'],
    noteProgress: {},
  };
}

function loadProgress(): DrillProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DrillProgressStore;
  } catch { /* ignore */ }
  return emptyProgress();
}

function saveProgress(p: DrillProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

interface StageInfo {
  id: DrillStage;
  titleKey: string;
  descKey: string;
  color: string;
}

const STAGE_INFO: StageInfo[] = [
  { id: 'treble-1oct',  titleKey: 'staffNotation.stageTreble1Oct',  descKey: 'staffNotation.stageTreble1OctDesc',  color: '#7c3aed' },
  { id: 'treble-2oct',  titleKey: 'staffNotation.stageTreble2Oct',  descKey: 'staffNotation.stageTreble2OctDesc',  color: '#2563eb' },
  { id: 'treble-free',  titleKey: 'staffNotation.stageTrebleFree',  descKey: 'staffNotation.stageTrebleFreeDesc',  color: '#059669' },
  { id: 'bass-free',    titleKey: 'staffNotation.stageBassFree',    descKey: 'staffNotation.stageBassFreeDesc',    color: '#d97706' },
  { id: 'combined',     titleKey: 'staffNotation.stageCombined',    descKey: 'staffNotation.stageCombinedDesc',    color: '#dc2626' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AnswerButtonProps {
  label: string;
  state: 'idle' | 'correct' | 'wrong' | 'reveal';
  onClick: () => void;
  disabled: boolean;
}

function AnswerButton({ label, state, onClick, disabled }: AnswerButtonProps) {
  let bg = '#fff';
  let border = '#d9d9d9';
  let color = '#333';
  let icon = null;

  if (state === 'correct') { bg = '#d1fae5'; border = '#059669'; color = '#065f46'; icon = <CheckOutlined />; }
  else if (state === 'wrong')   { bg = '#fee2e2'; border = '#dc2626'; color = '#991b1b'; icon = <CloseOutlined />; }
  else if (state === 'reveal')  { bg = '#ddd6fe'; border = '#7c3aed'; color = '#4c1d95'; }

  return (
    <Button
      block
      size="large"
      disabled={disabled}
      onClick={onClick}
      icon={icon ?? undefined}
      style={{
        height: 52,
        fontWeight: 600,
        fontSize: 16,
        background: bg,
        borderColor: border,
        color,
        transition: 'all 0.2s',
      }}
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Stage selector
// ---------------------------------------------------------------------------

interface StageSelectorProps {
  current: DrillStage;
  unlocked: DrillStage[];
  onSelect: (s: DrillStage) => void;
  noteProgress: Record<string, NoteProgress>;
}

function StageSelector({ current, unlocked, onSelect, noteProgress }: StageSelectorProps) {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {STAGE_INFO.map((s) => {
        const isUnlocked = unlocked.includes(s.id);
        const isCurrent = s.id === current;
        const pool = DRILL_STAGE_NOTES[s.id];
        const masteredCount = pool.filter((n) => noteProgress[n]?.mastered).length;
        const total = pool.length;

        return (
          <Tooltip
            key={s.id}
            title={
              isUnlocked
                ? t(s.descKey)
                : t('staffNotation.stageLocked')
            }
          >
            <Button
              type={isCurrent ? 'primary' : 'default'}
              onClick={() => isUnlocked && onSelect(s.id)}
              disabled={!isUnlocked}
              style={{
                borderColor: isCurrent ? s.color : undefined,
                background: isCurrent ? s.color : undefined,
              }}
              icon={isUnlocked ? undefined : <LockOutlined />}
            >
              <span>{t(s.titleKey)}</span>
              {isUnlocked && (
                <Tag
                  style={{ marginLeft: 6, fontSize: 11 }}
                  color={masteredCount === total ? 'success' : 'default'}
                >
                  {masteredCount}/{total}
                </Tag>
              )}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress board
// ---------------------------------------------------------------------------

interface ProgressBoardProps {
  pool: readonly string[];
  noteProgress: Record<string, NoteProgress>;
  currentNote: string | null;
}

function ProgressBoard({ pool, noteProgress, currentNote }: ProgressBoardProps) {
  const { t } = useTranslation();

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('staffNotation.masteryRequired')}
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {pool.map((note) => {
          const p = noteProgress[note];
          const streak = p?.correctStreak ?? 0;
          const mastered = p?.mastered ?? false;
          const isCurrent = note === currentNote;

          return (
            <Tooltip
              key={note}
              title={`${note} — ${p ? `${p.totalCorrect}/${p.totalAttempts}` : '0/0'}`}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: `2px solid ${isCurrent ? '#7c3aed' : mastered ? '#059669' : '#e0e0e0'}`,
                  background: mastered ? '#d1fae5' : isCurrent ? '#ede9fe' : '#f9f9f9',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  transition: 'all 0.2s',
                  cursor: 'default',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: 600, color: mastered ? '#065f46' : '#555', lineHeight: 1 }}>
                  {note}
                </Text>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: MASTERY_STREAK }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: mastered ? '#059669' : i < streak ? '#7c3aed' : '#ddd',
                      }}
                    />
                  ))}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DrillSession() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const { playNote } = useAudio();

  const [store, setStore] = useState<DrillProgressStore>(loadProgress);
  const [stage, setStage] = useState<DrillStage>('treble-1oct');
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  const pool = useMemo(() => DRILL_STAGE_NOTES[stage], [stage]);
  const clef = useMemo(
    () => (currentNote ? getClefForNote(currentNote, stage) : 'treble'),
    [currentNote, stage],
  );
  const stageComplete = useMemo(
    () => isStageComplete(pool, store.noteProgress),
    [pool, store.noteProgress],
  );

  const replayCurrentNote = useCallback(() => {
    if (!currentNote) return;
    void playNote(currentNote, NOTE_PLAY_DURATION);
  }, [currentNote, playNote]);

  const playAnswerFeedback = useCallback(
    (answer: string, expected: string) => {
      void (async () => {
        if (answer === expected) {
          await playNote(expected, NOTE_PLAY_DURATION);
          return;
        }

        await playNote(answer, NOTE_PLAY_DURATION);
        await wait(ANSWER_FEEDBACK_DELAY_MS);
        await playNote(expected, NOTE_PLAY_DURATION);
      })();
    },
    [playNote],
  );

  // Persist store whenever it changes
  useEffect(() => { saveProgress(store); }, [store]);

  // Generate a new question
  const nextQuestion = useCallback(
    (lastNote?: string) => {
      const note = selectDrillNote(pool, store.noteProgress, lastNote);
      const distractors = getDrillDistractors(note, pool);
      setCurrentNote(note);
      setChoices(shuffleArray([note, ...distractors]));
      setChosen(null);
      void playNote(note, NOTE_PLAY_DURATION);
    },
    [pool, store.noteProgress, playNote],
  );

  // Start or restart the stage
  const startStage = useCallback(
    (s: DrillStage) => {
      setStage(s);
      setChosen(null);
      setCurrentNote(null);
      // Slight delay so pool updates before generating question
      setTimeout(() => {
        const note = selectDrillNote(DRILL_STAGE_NOTES[s], store.noteProgress);
        const distractors = getDrillDistractors(note, DRILL_STAGE_NOTES[s]);
        setCurrentNote(note);
        setChoices(shuffleArray([note, ...distractors]));
        void playNote(note, NOTE_PLAY_DURATION);
      }, 0);
    },
    [store.noteProgress, playNote],
  );

  // Initialize first question on mount
  useEffect(() => {
    const note = selectDrillNote(pool, store.noteProgress);
    const distractors = getDrillDistractors(note, pool);
    setCurrentNote(note);
    setChoices(shuffleArray([note, ...distractors]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (!currentNote || chosen !== null) return;
      setChosen(answer);
      setSessionTotal((n) => n + 1);

      const isCorrect = answer === currentNote;
      playAnswerFeedback(answer, currentNote);

      setStore((prev) => {
        const existing = prev.noteProgress[currentNote] ?? {
          correctStreak: 0, totalCorrect: 0, totalAttempts: 0, mastered: false,
        };
        const newStreak = isCorrect ? existing.correctStreak + 1 : 0;
        const mastered = newStreak >= MASTERY_STREAK;
        const updated: NoteProgress = {
          correctStreak: mastered ? MASTERY_STREAK : newStreak,
          totalCorrect: existing.totalCorrect + (isCorrect ? 1 : 0),
          totalAttempts: existing.totalAttempts + 1,
          mastered,
        };

        const newProgress = { ...prev.noteProgress, [currentNote]: updated };

        // Unlock next stage if this stage is now complete
        const stageNowComplete = pool.every(
          (n) => (n === currentNote ? updated : newProgress[n])?.mastered,
        );
        const stageIdx = DRILL_STAGE_ORDER.indexOf(stage);
        const nextStage = DRILL_STAGE_ORDER[stageIdx + 1];
        const shouldUnlock =
          stageNowComplete &&
          nextStage &&
          !prev.unlockedStages.includes(nextStage) &&
          ['treble-1oct', 'treble-2oct'].includes(stage);

        return {
          unlockedStages: shouldUnlock
            ? [...prev.unlockedStages, nextStage]
            : prev.unlockedStages,
          noteProgress: newProgress,
        };
      });

      if (isCorrect) {
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
      } else {
        setStreak(0);
      }
    },
    [currentNote, chosen, pool, stage, playAnswerFeedback],
  );

  const handleNext = useCallback(() => {
    nextQuestion(currentNote ?? undefined);
  }, [nextQuestion, currentNote]);

  const handleReset = useCallback(() => {
    const newStore: DrillProgressStore = {
      ...store,
      noteProgress: Object.fromEntries(
        Object.entries(store.noteProgress).filter(([k]) => !pool.includes(k)),
      ),
    };
    setStore(newStore);
    setChosen(null);
    const note = selectDrillNote(pool, newStore.noteProgress);
    const distractors = getDrillDistractors(note, pool);
    setCurrentNote(note);
    setChoices(shuffleArray([note, ...distractors]));
    setStreak(0);
  }, [store, pool]);

  // Determine answer button states
  const getButtonState = useCallback(
    (option: string): 'idle' | 'correct' | 'wrong' | 'reveal' => {
      if (chosen === null) return 'idle';
      if (option === currentNote) return chosen === currentNote ? 'correct' : 'reveal';
      if (option === chosen) return 'wrong';
      return 'idle';
    },
    [chosen, currentNote],
  );

  const masteredCount = pool.filter((n) => store.noteProgress[n]?.mastered).length;
  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;

  return (
    <Card
      title={
        <Space>
          <span style={{ fontSize: 18 }}>🎓</span>
          <span style={{ fontWeight: 600 }}>{t('staffNotation.drillTitle')}</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        {t('staffNotation.drillHint')}
      </Paragraph>

      {/* Stage selector */}
      <StageSelector
        current={stage}
        unlocked={store.unlockedStages}
        onSelect={startStage}
        noteProgress={store.noteProgress}
      />

      {/* Stage progress bar */}
      <Space style={{ marginBottom: 16 }} wrap>
        <Text style={{ fontSize: 13 }}>
          {t('staffNotation.stageProgress', { done: masteredCount, total: pool.length })}
        </Text>
        <Progress
          percent={Math.round((masteredCount / pool.length) * 100)}
          size="small"
          style={{ width: 180 }}
          strokeColor={masteredCount === pool.length ? '#059669' : '#7c3aed'}
        />
        {accuracy !== null && (
          <Tag icon={<TrophyOutlined />} color="gold">
            {t('staffNotation.accuracy')} {accuracy}%
          </Tag>
        )}
        {streak >= 3 && (
          <Tag icon={<FireOutlined />} color="red">
            {t('staffNotation.streak', { n: streak })}
          </Tag>
        )}
      </Space>

      {/* Stage complete banner */}
      {stageComplete && (
        <div
          style={{
            background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
            border: '1px solid #059669',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 20,
            textAlign: 'center',
          }}
        >
          <Text strong style={{ fontSize: 16, color: '#065f46' }}>
            🎉 {t('staffNotation.stageComplete')}
          </Text>
          {DRILL_STAGE_ORDER.indexOf(stage) < DRILL_STAGE_ORDER.length - 1 && (
            <Button
              type="primary"
              style={{ marginLeft: 16, background: '#059669', borderColor: '#059669' }}
              onClick={() => {
                const next = DRILL_STAGE_ORDER[DRILL_STAGE_ORDER.indexOf(stage) + 1];
                if (next && store.unlockedStages.includes(next)) startStage(next);
              }}
            >
              {t('staffNotation.stageCompleteAction')} →
            </Button>
          )}
        </div>
      )}

      <Row gutter={[24, 24]}>
        {/* Staff display + answer area */}
        <Col xs={24} md={14}>
          <div
            role="button"
            tabIndex={currentNote ? 0 : -1}
            onClick={replayCurrentNote}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                replayCurrentNote();
              }
            }}
            style={{
              background: '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 12,
              padding: '16px 12px',
              textAlign: 'center',
              marginBottom: 16,
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentNote ? 'pointer' : 'default',
            }}
          >
            <Text type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
              {t('staffNotation.whatNote')}
            </Text>
            {currentNote && (
              <StaffDisplay
                notes={currentNote}
                clef={clef}
                highlightNote={chosen !== null ? currentNote : undefined}
                width={screens.md ? 260 : 220}
                height={190}
              />
            )}
          </div>

          {/* Answer feedback */}
          {chosen !== null && (
            <div
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                marginBottom: 12,
                background: chosen === currentNote ? '#d1fae5' : '#fee2e2',
                border: `1px solid ${chosen === currentNote ? '#059669' : '#dc2626'}`,
              }}
            >
              <Text strong style={{ color: chosen === currentNote ? '#065f46' : '#991b1b' }}>
                {chosen === currentNote
                  ? `✓ ${t('staffNotation.correct')}`
                  : `✗ ${t('staffNotation.wrong')} ${currentNote}`}
              </Text>
            </div>
          )}

          {/* Answer buttons 2×2 grid */}
          <Row gutter={[8, 8]}>
            {choices.map((option) => (
              <Col key={option} span={12}>
                <AnswerButton
                  label={option}
                  state={getButtonState(option)}
                  onClick={() => handleAnswer(option)}
                  disabled={chosen !== null}
                />
              </Col>
            ))}
          </Row>

          {chosen !== null && (
            <Button
              type="primary"
              block
              size="large"
              style={{ marginTop: 12 }}
              onClick={handleNext}
            >
              {t('staffNotation.nextQuestion')} →
            </Button>
          )}
        </Col>

        {/* Progress board */}
        <Col xs={24} md={10}>
          <div style={{ marginBottom: 12 }}>
            <Space>
              <Text strong style={{ fontSize: 14 }}>{t('staffNotation.drillTitle')}</Text>
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
          <ProgressBoard
            pool={pool}
            noteProgress={store.noteProgress}
            currentNote={chosen !== null ? currentNote : null}
          />
        </Col>
      </Row>
    </Card>
  );
}

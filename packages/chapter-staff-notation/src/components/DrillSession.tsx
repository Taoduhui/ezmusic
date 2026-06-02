/**
 * DrillSession — Anki-like progressive staff note reading drill.
 *
 * Stages:
 *   1. Treble · C4       (C4–B4, 7 notes)
 *   2. Treble · C5       (C5–B5, 7 notes)
 *   3. Treble · C4 + C5  (C4–B5, 14 notes)
 *   4. Bass   · C2       (C2–B2, 7 notes)
 *   5. Bass   · C3       (C3–B3, 7 notes)
 *   6. Bass   · C2 + C3  (C2–B3, 14 notes)
 *   7. Grand staff       (C2–B5, 28 notes across bass/treble clefs)
 *
 * Mastery rule: 3 consecutive correct answers per note.
 * Progress is persisted to localStorage.
 * Users can freely switch between any stage at any time.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Card, Button, Space, Typography, Progress, Tag, Badge,
  Divider, Row, Col, Tooltip, Popconfirm, Grid, Select, Switch,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, ReloadOutlined,
  TrophyOutlined, FireOutlined,
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
import { PianoKeyboard, type KeyHighlight } from '@ezmusic/shared';

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

/** Training mode: note-name buttons or piano keyboard */
type DrillMode = 'note-name' | 'piano';

/** Compute the keyboard range for a given note pool (extend max to next C for completeness). */
function getKeyboardRange(pool: readonly string[]): { min: string; max: string } {
  const min = pool[0];
  const max = pool[pool.length - 1];
  // If the max note is not a C, extend to C of the next octave
  const maxPC = max.replace(/\d+$/, '');
  const maxOctMatch = /\d+$/.exec(max);
  const maxOct = maxOctMatch ? parseInt(maxOctMatch[0], 10) : 4;
  const extendedMax = maxPC === 'C' ? max : `C${maxOct + 1}`;
  return { min, max: extendedMax };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrillProgressStore {
  noteProgress: Record<string, NoteProgress>;
}

function emptyProgress(): DrillProgressStore {
  return {
    noteProgress: {},
  };
}

function loadProgress(): DrillProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DrillProgressStore & { unlockedStages?: unknown }>;
      return {
        noteProgress: parsed.noteProgress ?? {},
      };
    }
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
  { id: 'treble-c4',       titleKey: 'staffNotation.stageTrebleC4',       descKey: 'staffNotation.stageTrebleC4Desc',       color: '#7c3aed' },
  { id: 'treble-c5',       titleKey: 'staffNotation.stageTrebleC5',       descKey: 'staffNotation.stageTrebleC5Desc',       color: '#2563eb' },
  { id: 'treble-c4c5',     titleKey: 'staffNotation.stageTrebleC4C5',     descKey: 'staffNotation.stageTrebleC4C5Desc',     color: '#059669' },
  { id: 'bass-c2',         titleKey: 'staffNotation.stageBassC2',         descKey: 'staffNotation.stageBassC2Desc',         color: '#d97706' },
  { id: 'bass-c3',         titleKey: 'staffNotation.stageBassC3',         descKey: 'staffNotation.stageBassC3Desc',         color: '#dc2626' },
  { id: 'bass-c2c3',       titleKey: 'staffNotation.stageBassC2C3',       descKey: 'staffNotation.stageBassC2C3Desc',       color: '#0891b2' },
  { id: 'combined-grand',  titleKey: 'staffNotation.stageCombinedGrand',  descKey: 'staffNotation.stageCombinedGrandDesc',  color: '#6d28d9' },
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
  onSelect: (s: DrillStage) => void;
  noteProgress: Record<string, NoteProgress>;
}

function StageSelector({ current, onSelect, noteProgress }: StageSelectorProps) {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 20 }}>
      {STAGE_INFO.map((s) => {
        const isCurrent = s.id === current;
        const pool = DRILL_STAGE_NOTES[s.id];

        return (
          <Tooltip
            key={s.id}
            title={t(s.descKey)}
          >
            <Button
              type={isCurrent ? 'primary' : 'default'}
              onClick={() => onSelect(s.id)}
              style={{
                borderColor: isCurrent ? s.color : undefined,
                background: isCurrent ? s.color : undefined,
              }}
            >
              <span>{t(s.titleKey)}</span>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 6 }}>
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
  const [stage, setStage] = useState<DrillStage>(DRILL_STAGE_ORDER[0]);
  const [drillMode, setDrillMode] = useState<DrillMode>('note-name');
  const [showKeyboardLabels, setShowKeyboardLabels] = useState(true);
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

  // Keyboard range for piano mode
  const keyboardRange = useMemo(
    () => getKeyboardRange(pool),
    [pool],
  );

  // Answer highlights for piano mode keyboard
  const keyboardHighlights = useMemo<KeyHighlight[]>(() => {
    if (chosen === null) return [];
    if (chosen === currentNote) {
      return [{ note: chosen, state: 'correct' }];
    }
    const highlights: KeyHighlight[] = [
      { note: chosen, state: 'wrong' },
    ];
    if (currentNote) {
      highlights.push({ note: currentNote, state: 'reveal' });
    }
    return highlights;
  }, [chosen, currentNote]);

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

        return {
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
    [currentNote, chosen, playAnswerFeedback],
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

      {/* Training mode selector */}
      <Space style={{ marginBottom: 16 }} wrap>
        <Text style={{ fontSize: 13 }}>{t('staffNotation.trainingMode')}:</Text>
        <Select
          value={drillMode}
          onChange={(v) => setDrillMode(v)}
          options={[
            { value: 'note-name', label: t('staffNotation.trainingModeNoteName') },
            { value: 'piano', label: t('staffNotation.trainingModePiano') },
          ]}
          style={{ minWidth: 180 }}
          size="small"
        />
        {drillMode === 'piano' && (
          <Space size={4}>
            <Switch
              checked={showKeyboardLabels}
              onChange={setShowKeyboardLabels}
              size="small"
            />
            <Text style={{ fontSize: 13 }}>{t('staffNotation.showKeyLabels')}</Text>
          </Space>
        )}
      </Space>

      {/* Stage selector */}
      <StageSelector
        current={stage}
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
                if (next) startStage(next);
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
                width={screens.xl ? 440 : screens.lg ? 380 : screens.md ? 300 : 220}
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

          {/* Answer buttons (note-name mode only) */}
          {drillMode === 'note-name' && (
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
          )}

          {/* Next button (note-name mode — placed inside col) */}
          {drillMode === 'note-name' && chosen !== null && (
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

      {/* Piano keyboard — full width below the two-column layout (piano mode only) */}
      {drillMode === 'piano' && (
        <div style={{ marginTop: 8 }}>
          <PianoKeyboard
            onKeyPress={(_pc, note) => handleAnswer(note)}
            noteRange={keyboardRange}
            highlightKeys={keyboardHighlights}
            disabled={chosen !== null}
            showNoteLabels={showKeyboardLabels}
          />
        </div>
      )}

      {/* Next button (piano mode — full width below keyboard) */}
      {drillMode === 'piano' && chosen !== null && (
        <Button
          type="primary"
          block
          size="large"
          style={{ marginTop: 16 }}
          onClick={handleNext}
        >
          {t('staffNotation.nextQuestion')} →
        </Button>
      )}
    </Card>
  );
}

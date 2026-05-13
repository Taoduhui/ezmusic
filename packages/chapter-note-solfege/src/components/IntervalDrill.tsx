/**
 * Interval speed-drill: two notes within 2 octaves, count semitones, 4-choice quiz.
 */
import { useState, useCallback } from 'react';
import { Button, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURAL_PC = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

interface NoteEntry { note: string; idx: number }
// One octave, natural notes only: C4 – B4
const NOTES: NoteEntry[] = NATURAL_PC.map((pc) => ({ note: `${pc}4`, idx: PC.indexOf(pc) }));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Question {
  noteA: string;
  noteB: string;
  semitones: number;
  options: number[];
}

function makeQuestion(): Question {
  const n = NOTES.length; // 7
  let idxA: number, idxB: number;
  do {
    idxA = Math.floor(Math.random() * n);
    idxB = Math.floor(Math.random() * n);
  } while (idxA === idxB);

  const lower = Math.min(idxA, idxB);
  const upper = Math.max(idxA, idxB);
  // Semitones between the two natural notes (chromatic distance)
  const semitones = NOTES[upper].idx - NOTES[lower].idx;

  // Distractors: neighbours of correct answer, clamped to 1–11, no duplicates
  const pool = shuffle(
    Array.from({ length: 11 }, (_, k) => k + 1).filter((v) => v !== semitones),
  ).slice(0, 3);

  return {
    noteA: NOTES[lower].note,
    noteB: NOTES[upper].note,
    semitones,
    options: shuffle([semitones, ...pool]),
  };
}

function NoteBox({ note }: { note: string }) {
  const pc = note.replace(/\d/, '');
  return (
    <div
      style={{
        width: 88,
        height: 88,
        borderRadius: 18,
        flexShrink: 0,
        background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(124,58,237,0.28)',
      }}
    >
      <span style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{pc}</span>
    </div>
  );
}

export default function IntervalDrill() {
  const { i18n } = useTranslation();
  const isZh = i18n.language === 'zh-CN';

  const [q, setQ] = useState<Question>(() => makeQuestion());
  const [selected, setSelected] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const isAnswered = selected !== null;
  const isCorrect = selected === q.semitones;

  const handleSelect = useCallback(
    (opt: number) => {
      if (selected !== null) return;
      setSelected(opt);
      setTotalCount((n) => n + 1);
      if (opt === q.semitones) {
        setStreak((s) => s + 1);
        setCorrectCount((c) => c + 1);
      } else {
        setStreak(0);
      }
    },
    [selected, q.semitones],
  );

  const handleNext = useCallback(() => {
    setQ(makeQuestion());
    setSelected(null);
  }, []);

  return (
    <div>
      {/* Stats row */}
      {totalCount > 0 && (
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isZh ? `正确 ${correctCount} / ${totalCount}` : `${correctCount} / ${totalCount} correct`}
            {streak >= 3 && (
              <span style={{ marginLeft: 8, color: '#f59e0b' }}>🔥 ×{streak}</span>
            )}
          </Text>
        </div>
      )}

      {/* Question */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          marginBottom: 32,
          flexWrap: 'wrap',
        }}
      >
        <NoteBox note={q.noteA} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, color: '#c4b5fd', lineHeight: 1, marginBottom: 6 }}>↔</div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {isZh ? '之间有几个半音？' : 'How many semitones apart?'}
          </Text>
        </div>
        <NoteBox note={q.noteB} />
      </div>

      {/* 2×2 option grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          maxWidth: 320,
          margin: '0 auto 24px',
        }}
      >
        {q.options.map((opt) => {
          const isRight = opt === q.semitones;
          const isPicked = opt === selected;
          let bg = '#f5f3ff', border = '#c4b5fd', color = '#5b21b6';
          if (isAnswered) {
            if (isRight)        { bg = '#dcfce7'; border = '#86efac'; color = '#15803d'; }
            else if (isPicked)  { bg = '#fee2e2'; border = '#fca5a5'; color = '#dc2626'; }
            else                { bg = '#f4f4f5'; border = '#e4e4e7'; color = '#a1a1aa'; }
          }
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              style={{
                padding: '16px 0',
                borderRadius: 12,
                border: `2px solid ${border}`,
                background: bg,
                color,
                fontSize: 24,
                fontWeight: 700,
                cursor: isAnswered ? 'default' : 'pointer',
                transition: 'all 0.15s',
                userSelect: 'none',
                outline: 'none',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {/* Feedback + next */}
      {isAnswered && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 14 }}>
            {isCorrect ? (
              <Tag
                color="success"
                style={{ fontSize: 14, padding: '5px 16px', borderRadius: 8 }}
              >
                ✓ {isZh ? '正确！' : 'Correct!'}
              </Tag>
            ) : (
              <Tag
                color="error"
                style={{ fontSize: 14, padding: '5px 16px', borderRadius: 8 }}
              >
                ✗ {isZh ? `答案是 ${q.semitones} 个半音` : `Answer: ${q.semitones} semitones`}
              </Tag>
            )}
          </div>
          <Button
            type="primary"
            onClick={handleNext}
            style={{ borderRadius: 8, height: 40, paddingInline: 28 }}
          >
            {isZh ? '下一题 →' : 'Next →'}
          </Button>
        </div>
      )}
    </div>
  );
}

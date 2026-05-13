/**
 * Interactive piano keyboard (C4 – B4 + C5).
 * Data-driven by NoteLabel map from @ezmusic/shared theory.
 */
import { Tooltip, Typography } from 'antd';
import type { NoteLabel } from '../music/theory';

const { Text } = Typography;

interface PianoKey {
  note: string;          // scientific note, e.g. "C4"
  pitchClass: string;
  isBlack: boolean;
  whiteIndex?: number;   // position among white keys (used for black key layout)
  blackAfter?: number;   // white-key index this black key follows
}

const ALL_KEYS: PianoKey[] = [
  { note: 'C4',  pitchClass: 'C',  isBlack: false, whiteIndex: 0 },
  { note: 'C#4', pitchClass: 'C#', isBlack: true,  blackAfter: 0 },
  { note: 'D4',  pitchClass: 'D',  isBlack: false, whiteIndex: 1 },
  { note: 'D#4', pitchClass: 'D#', isBlack: true,  blackAfter: 1 },
  { note: 'E4',  pitchClass: 'E',  isBlack: false, whiteIndex: 2 },
  { note: 'F4',  pitchClass: 'F',  isBlack: false, whiteIndex: 3 },
  { note: 'F#4', pitchClass: 'F#', isBlack: true,  blackAfter: 3 },
  { note: 'G4',  pitchClass: 'G',  isBlack: false, whiteIndex: 4 },
  { note: 'G#4', pitchClass: 'G#', isBlack: true,  blackAfter: 4 },
  { note: 'A4',  pitchClass: 'A',  isBlack: false, whiteIndex: 5 },
  { note: 'A#4', pitchClass: 'A#', isBlack: true,  blackAfter: 5 },
  { note: 'B4',  pitchClass: 'B',  isBlack: false, whiteIndex: 6 },
  { note: 'C5',  pitchClass: 'C',  isBlack: false, whiteIndex: 7 },
];

const WHITE_KEYS = ALL_KEYS.filter((k) => !k.isBlack);
const BLACK_KEYS = ALL_KEYS.filter((k) => k.isBlack);

const WHITE_KEY_W = 52;
const WHITE_KEY_H = 180;
const BLACK_KEY_W = 32;
const BLACK_KEY_H = 112;
const TOTAL_W = WHITE_KEYS.length * WHITE_KEY_W;

export interface PianoKeyboardProps {
  labels: Map<string, NoteLabel>;
  /** Fully-qualified active note, e.g. "C4", "C5", "F#4" */
  activeNote: string;
  /** Set of pitch classes in the current scale */
  inScaleSet: Set<string>;
  onKeyPress: (pitchClass: string, note: string) => void;
}

function keyBg(pc: string, isBlack: boolean, isActive: boolean, isTonic: boolean, inScale: boolean): string {
  if (isBlack) {
    if (isActive) return '#7c3aed';
    if (isTonic) return '#5b21b6';
    return '#222';
  }
  if (isActive) return '#ede9fe';
  if (isTonic) return '#f5f3ff';
  if (!inScale) return '#f9f9f9';
  return '#fff';
}

export default function PianoKeyboard({ labels, activeNote, inScaleSet, onKeyPress }: PianoKeyboardProps) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div style={{ position: 'relative', width: TOTAL_W, height: WHITE_KEY_H, userSelect: 'none', margin: '0 auto' }}>
        {/* White keys */}
        {WHITE_KEYS.map((k, idx) => {
          const label = labels.get(k.pitchClass);
          const isActive = k.note === activeNote;
          const isTonic = label?.isTonic ?? false;
          const inScale = inScaleSet.has(k.pitchClass);
          const bg = keyBg(k.pitchClass, false, isActive, isTonic, inScale);
          const displayFreq = k.note === 'C5' ? parseFloat((label!.freq * 2).toFixed(2)) : label?.freq;
          const tooltip = label
            ? `${k.pitchClass}  |  ${label.solfege}  |  ${displayFreq} Hz`
            : k.pitchClass;
          return (
            <Tooltip key={k.note} title={tooltip} placement="bottom">
              <div
                onMouseDown={() => onKeyPress(k.pitchClass, k.note)}
                style={{
                  position: 'absolute',
                  left: idx * WHITE_KEY_W,
                  top: 0,
                  width: WHITE_KEY_W - 2,
                  height: WHITE_KEY_H,
                  background: bg,
                  border: `1px solid ${isActive ? '#7c3aed' : '#d0d0d0'}`,
                  borderRadius: '0 0 8px 8px',
                  cursor: 'pointer',
                  boxShadow: isActive ? 'inset 0 -4px 0 #7c3aed' : 'inset 0 -4px 0 #bbb',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 10,
                  gap: 2,
                  zIndex: 1,
                  transition: 'background 0.1s',
                }}
              >
                {label && inScale && (
                  <Text style={{ fontSize: 10, color: isActive ? '#7c3aed' : '#aaa', lineHeight: 1 }}>
                    {label.solfege}
                  </Text>
                )}
                <Text style={{ fontSize: 12, fontWeight: isActive ? 700 : 400, color: isActive ? '#7c3aed' : (inScale ? '#555' : '#ccc'), lineHeight: 1 }}>
                  {k.pitchClass}
                </Text>
                {isTonic && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', marginTop: 2 }} />
                )}
              </div>
            </Tooltip>
          );
        })}

        {/* Black keys */}
        {BLACK_KEYS.map((k) => {
          const label = labels.get(k.pitchClass);
          const isActive = k.note === activeNote;
          const isTonic = label?.isTonic ?? false;
          const inScale = inScaleSet.has(k.pitchClass);
          const bg = keyBg(k.pitchClass, true, isActive, isTonic, inScale);
          const left = (k.blackAfter! + 1) * WHITE_KEY_W - BLACK_KEY_W / 2 - 1;
          const tooltip = label
            ? `${k.pitchClass}  |  ${label.solfege}  |  ${label.freq} Hz`
            : k.pitchClass;
          return (
            <Tooltip key={k.note} title={tooltip} placement="top">
              <div
                onMouseDown={() => onKeyPress(k.pitchClass, k.note)}
                style={{
                  position: 'absolute',
                  left,
                  top: 0,
                  width: BLACK_KEY_W,
                  height: BLACK_KEY_H,
                  background: bg,
                  borderRadius: '0 0 6px 6px',
                  cursor: 'pointer',
                  zIndex: 2,
                  boxShadow: isActive
                    ? '0 4px 12px rgba(124,58,237,0.6)'
                    : '2px 4px 6px rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 8,
                  gap: 2,
                  transition: 'background 0.1s',
                }}
              >
                {label && inScale && (
                  <Text style={{ fontSize: 9, color: isActive ? '#fff' : '#999', lineHeight: 1 }}>
                    {label.solfege}
                  </Text>
                )}
                <Text style={{ fontSize: 10, color: isActive ? '#fff' : '#555', lineHeight: 1 }}>
                  {k.pitchClass}
                </Text>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

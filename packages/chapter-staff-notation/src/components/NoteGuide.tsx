/**
 * NoteGuide — shows the natural notes for a clef as clickable buttons.
 * Clicking a note renders it in the StaffDisplay and plays it via Tone.js.
 */
import { useState, useCallback } from 'react';
import {
  Button, Card, Space, Tag, Row, Col, Alert, Text, Paragraph, SoundOutlined, useAudio,
} from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';
import StaffDisplay from './StaffDisplay';

interface NoteGuideProps {
  clef: 'treble' | 'bass';
  /** Ordered array of natural note names to show (e.g. ['C4','D4','E4',...]) */
  notes: string[];
  title: string;
  description: string;
  mnemonicLines: string;
  mnemonicSpaces: string;
}

/** Map a note to its display color for the button */
function noteButtonStyle(note: string, selected: boolean) {
  if (selected) {
    return { background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' };
  }
  // Alternate light tints by pitch class for visual variety
  const pc = note.replace(/[0-9]/g, '');
  const sharpNotes = ['C#', 'D#', 'F#', 'G#', 'A#'];
  if (sharpNotes.includes(pc)) {
    return { background: '#f0f0f0', color: '#555', borderColor: '#d0d0d0' };
  }
  return {};
}

export default function NoteGuide({
  clef,
  notes,
  title,
  description,
  mnemonicLines,
  mnemonicSpaces,
}: NoteGuideProps) {
  const { t } = useTranslation();
  const { playNote } = useAudio();
  const [selectedNote, setSelectedNote] = useState<string>(notes[0]);

  const handleNoteClick = useCallback(
    (note: string) => {
      setSelectedNote(note);
      playNote(note, 0.8);
    },
    [playNote],
  );

  return (
    <Card
      title={
        <Space wrap size={[8, 8]}>
          <span style={{ fontSize: 18 }}>🎵</span>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <Tag
            color="purple"
            style={{
              whiteSpace: 'normal',
              lineHeight: 1.4,
              paddingBlock: 4,
            }}
          >
            {description}
          </Tag>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      {/* Mnemonic hints */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        description={
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 13 }}>{mnemonicLines}</Text>
            <Text style={{ fontSize: 13 }}>{mnemonicSpaces}</Text>
          </Space>
        }
      />

      <Row gutter={[16, 16]} align="middle">
        {/* Note selector buttons */}
        <Col xs={24} md={14}>
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 10 }}>
            {t('staffNotation.noteGuideHint')}
          </Paragraph>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {notes.map((note) => {
              const isSelected = note === selectedNote;
              return (
                <Button
                  key={note}
                  size="middle"
                  onClick={() => handleNoteClick(note)}
                  style={{
                    minWidth: 52,
                    fontWeight: isSelected ? 700 : 400,
                    transition: 'all 0.15s',
                    ...noteButtonStyle(note, isSelected),
                  }}
                  icon={isSelected ? <SoundOutlined /> : undefined}
                >
                  {note}
                </Button>
              );
            })}
          </div>
        </Col>

        {/* Staff rendering for selected note */}
        <Col xs={24} md={10}>
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              {t('staffNotation.selectedNoteOn', { note: selectedNote })}
            </Text>
            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fafafa',
                display: 'inline-block',
                padding: '4px 12px',
              }}
            >
              <StaffDisplay
                notes={selectedNote}
                clef={clef}
                highlightNote={selectedNote}
                width={220}
                height={170}
              />
            </div>
          </div>
        </Col>
      </Row>
    </Card>
  );
}

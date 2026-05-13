/**
 * Chapter: Reading Music Notation (认识五线谱)
 * Shows concept cards, treble/bass clef guides, duration visual, and the Anki-like drill.
 */
import { Typography, Card, Row, Col, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  TREBLE_2OCT_NOTES,
  BASS_FREE_NOTES,
} from '@ezmusic/shared';

import NoteGuide from './components/NoteGuide';
import DurationVisual from './components/DurationVisual';
import DrillSession from './components/DrillSession';

const { Title, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Concept card helper
// ---------------------------------------------------------------------------

interface ConceptCardProps {
  emoji: string;
  title: string;
  subtitle: string;
  body: string;
  color: string;
}

function ConceptCard({ emoji, title, subtitle, body, color }: ConceptCardProps) {
  return (
    <Card
      style={{
        height: '100%',
        border: `1px solid ${color}33`,
        borderTop: `4px solid ${color}`,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <Space style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 24 }}>{emoji}</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
        </Space>
        <div>
          <Tag color={color}>{subtitle}</Tag>
        </div>
      </div>
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
        {body}
      </Paragraph>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main chapter component
// ---------------------------------------------------------------------------

export default function ChapterStaffNotation() {
  const { t } = useTranslation();

  const trebleNotes = (TREBLE_2OCT_NOTES as readonly string[]).slice();
  const bassNotes   = (BASS_FREE_NOTES as readonly string[]).slice();

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 48px' }}>
      {/* ── Hero banner ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 60%, #2563eb 100%)',
          borderRadius: 16,
          padding: '40px 32px',
          marginBottom: 32,
          color: '#fff',
        }}
      >
        <Title level={2} style={{ color: '#fff', marginBottom: 8 }}>
          🎼 {t('staffNotation.chapterTitle')}
        </Title>
        <Paragraph style={{ color: '#e0d9ff', fontSize: 15, marginBottom: 0 }}>
          {t('staffNotation.chapterSubtitle')}
        </Paragraph>
      </div>

      {/* ── Concept cards ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        <Col xs={24} md={8}>
          <ConceptCard
            emoji="📏"
            title={t('staffNotation.conceptCardStaff')}
            subtitle={t('staffNotation.conceptCardStaffDesc')}
            body={t('staffNotation.conceptCardStaffDetail')}
            color="#7c3aed"
          />
        </Col>
        <Col xs={24} md={8}>
          <ConceptCard
            emoji="⏱"
            title={t('staffNotation.conceptCardDuration')}
            subtitle={t('staffNotation.conceptCardDurationDesc')}
            body={t('staffNotation.conceptCardDurationDetail')}
            color="#2563eb"
          />
        </Col>
        <Col xs={24} md={8}>
          <ConceptCard
            emoji="🎵"
            title={t('staffNotation.conceptCardClef')}
            subtitle={t('staffNotation.conceptCardClefDesc')}
            body={t('staffNotation.conceptCardClefDetail')}
            color="#059669"
          />
        </Col>
      </Row>

      {/* ── Treble clef guide ── */}
      <NoteGuide
        clef="treble"
        notes={trebleNotes}
        title={t('staffNotation.trebleClefTitle')}
        description={t('staffNotation.trebleClefDesc')}
        mnemonicLines={t('staffNotation.trebleMnemonicLines')}
        mnemonicSpaces={t('staffNotation.trebleMnemonicSpaces')}
      />

      {/* ── Bass clef guide ── */}
      <NoteGuide
        clef="bass"
        notes={bassNotes}
        title={t('staffNotation.bassClefTitle')}
        description={t('staffNotation.bassClefDesc')}
        mnemonicLines={t('staffNotation.bassMnemonicLines')}
        mnemonicSpaces={t('staffNotation.bassMnemonicSpaces')}
      />

      {/* ── Duration visual ── */}
      <DurationVisual />

      {/* ── Drill session ── */}
      <DrillSession />
    </div>
  );
}

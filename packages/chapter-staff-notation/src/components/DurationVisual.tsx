/**
 * DurationVisual — interactive duration comparison using VexFlow low-level API.
 * Click any item to hear it; use "Play in sequence" to hear all four in order.
 */
import { useEffect, useRef, useId, useState, useCallback } from 'react';
import { Factory, Stave, StaveNote, Voice, VoiceMode, Formatter } from 'vexflow';
import { Typography, Card, Space, Button, Tooltip } from 'antd';
import { SoundOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAudio } from '@ezmusic/shared';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type DurKey = 'w' | 'h' | 'q' | '8';

interface DurConfig {
  key: DurKey;
  i18nLabel: string;
  color: string;
  /** Duration of the played note in seconds (♩=120: whole=2s, half=1s, …) */
  playDur: number;
  vfDur: string;
  count: number;
  numBeats: number;
  beatValue: number;
  beats: number | string;
  /** Proportion relative to eighth note (1 unit) for the comparison bar */
  ratio: number;
}

const DURATIONS: DurConfig[] = [
  { key: 'w',  i18nLabel: 'staffNotation.durationWhole',   color: '#7c3aed', playDur: 2.0,  vfDur: 'w', count: 1, numBeats: 4, beatValue: 4, beats: 4,   ratio: 8 },
  { key: 'h',  i18nLabel: 'staffNotation.durationHalf',    color: '#2563eb', playDur: 1.0,  vfDur: 'h', count: 2, numBeats: 4, beatValue: 4, beats: 2,   ratio: 4 },
  { key: 'q',  i18nLabel: 'staffNotation.durationQuarter', color: '#059669', playDur: 0.5,  vfDur: 'q', count: 4, numBeats: 4, beatValue: 4, beats: 1,   ratio: 2 },
  { key: '8',  i18nLabel: 'staffNotation.durationEighth',  color: '#d97706', playDur: 0.25, vfDur: '8', count: 4, numBeats: 2, beatValue: 4, beats: '½', ratio: 1 },
];

// ---------------------------------------------------------------------------
// Single duration item
// ---------------------------------------------------------------------------

function DurationItem({
  cfg,
  isSelected,
  isActive,
  onClick,
}: {
  cfg: DurConfig;
  isSelected: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const vfId = useId().replace(/:/g, '_');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    el.id = vfId;

    try {
      // Use Factory only to bootstrap the SVG renderer
      const vf = new Factory({ renderer: { elementId: vfId, width: 130, height: 140 } });
      const ctx = vf.getContext();

      // Draw stave directly — avoids EasyScore stem/time-signature quirks
      const stave = new Stave(10, 35, 110);
      stave.addClef('treble');
      stave.setContext(ctx).draw();

      const notes: StaveNote[] = Array.from({ length: cfg.count }, () =>
        new StaveNote(
          cfg.vfDur === 'w'
            ? { keys: ['b/4'], duration: cfg.vfDur }
            : { keys: ['b/4'], duration: cfg.vfDur, stemDirection: 1 },
        ),
      );
      notes.forEach((n) => n.setStyle({ fillStyle: cfg.color, strokeStyle: cfg.color }));

      const voice = new Voice({ numBeats: cfg.numBeats, beatValue: cfg.beatValue });
      voice.setMode(VoiceMode.SOFT);
      voice.addTickables(notes);

      new Formatter().joinVoices([voice]).format([voice], 80);
      voice.draw(ctx, stave);

      const svg = el.querySelector('svg');
      if (svg) { svg.style.display = 'block'; svg.style.margin = '0 auto'; }
    } catch { /* ignore render errors during hot reload */ }
  }, [cfg, vfId]);

  return (
    <Tooltip title={t('staffNotation.clickToHear')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        style={{
          textAlign: 'center',
          flex: '1 1 130px',
          minWidth: 130,
          cursor: 'pointer',
          border: `2px solid ${isSelected ? cfg.color : 'transparent'}`,
          borderRadius: 12,
          background: isSelected ? `${cfg.color}15` : 'transparent',
          padding: '8px 4px 4px',
          transition: 'all 0.2s',
          outline: 'none',
          boxShadow: isActive ? `0 0 0 4px ${cfg.color}40` : undefined,
        }}
      >
        <div ref={containerRef} style={{ lineHeight: 0, minHeight: 140 }} />
        <Text strong style={{ fontSize: 14, color: cfg.color, display: 'block', marginTop: 4 }}>
          {t(cfg.i18nLabel)}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('staffNotation.durationBeats', { beats: cfg.beats })}
        </Text>
        <div style={{ height: 18, marginTop: 2 }}>
          {isActive && <SoundOutlined style={{ color: cfg.color, fontSize: 13 }} />}
        </div>
      </div>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DurationVisual() {
  const { t } = useTranslation();
  const { playNote } = useAudio();

  const [selected, setSelected] = useState<DurKey | null>(null);
  const [active, setActive]     = useState<DurKey | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const handleClick = useCallback(
    (cfg: DurConfig) => {
      clearTimers();
      setSelected(cfg.key);
      setActive(cfg.key);
      playNote('B4', cfg.playDur);
      timersRef.current.push(setTimeout(() => setActive(null), cfg.playDur * 1000 + 300));
    },
    [playNote, clearTimers],
  );

  const playSequence = useCallback(() => {
    clearTimers();
    let delay = 0;
    DURATIONS.forEach((cfg) => {
      timersRef.current.push(
        setTimeout(() => {
          setSelected(cfg.key);
          setActive(cfg.key);
          playNote('B4', cfg.playDur);
        }, delay),
        setTimeout(() => setActive(null), delay + cfg.playDur * 1000 + 200),
      );
      delay += cfg.playDur * 1000 + 600;
    });
  }, [playNote, clearTimers]);

  const selectedCfg = DURATIONS.find((d) => d.key === selected);

  return (
    <Card
      title={
        <Space>
          <span style={{ fontSize: 18 }}>⏱</span>
          <span style={{ fontWeight: 600 }}>{t('staffNotation.durationTitle')}</span>
        </Space>
      }
      extra={
        <Button
          icon={<PlayCircleOutlined />}
          type="primary"
          ghost
          size="small"
          style={{ borderColor: '#7c3aed', color: '#7c3aed' }}
          onClick={playSequence}
        >
          {t('staffNotation.playSequence')}
        </Button>
      }
      style={{ marginBottom: 24 }}
    >
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        {t('staffNotation.durationHint')}
      </Text>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          justifyContent: 'space-around',
          alignItems: 'stretch',
          flexWrap: 'wrap',
        }}
      >
        {DURATIONS.map((cfg) => (
          <DurationItem
            key={cfg.key}
            cfg={cfg}
            isSelected={selected === cfg.key}
            isActive={active === cfg.key}
            onClick={() => handleClick(cfg)}
          />
        ))}
      </div>

      {/* Duration proportion bar — appears after first selection */}
      {selectedCfg && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#f9f9f9',
            borderRadius: 8,
            border: '1px solid #f0f0f0',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {t('staffNotation.durationRatio')}
          </Text>
          <div style={{ display: 'flex', gap: 3, height: 24, alignItems: 'center' }}>
            {DURATIONS.map((d) => (
              <Tooltip
                key={d.key}
                title={`${t(d.i18nLabel)} · ${t('staffNotation.durationBeats', { beats: d.beats })}`}
              >
                <div
                  onClick={() => handleClick(d)}
                  style={{
                    flex: d.ratio,
                    height: selected === d.key ? 24 : 14,
                    background: d.color,
                    opacity: selected === d.key ? 1 : 0.25,
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.25s',
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <Text style={{ fontSize: 13, color: selectedCfg.color, marginTop: 8, display: 'block' }}>
            {t(selectedCfg.i18nLabel)} = {t('staffNotation.durationBeats', { beats: selectedCfg.beats })}
          </Text>
        </div>
      )}
    </Card>
  );
}

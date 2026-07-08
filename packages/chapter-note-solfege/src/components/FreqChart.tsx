/**
 * Frequency bar chart for one octave.
 * Pure SVG implementation — log2 y-axis, no chart library dependency.
 */
import { useState } from 'react';
import { Tooltip } from '@ezmusic/shared';
import type { FreqDataPoint } from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';

interface FreqChartProps {
  data: FreqDataPoint[];
  onSelectNote: (pitchClass: string) => void;
}

const SVG_W = 600;
const SVG_H = 200;
const PAD = { top: 12, right: 16, bottom: 36, left: 52 };
const PLOT_W = SVG_W - PAD.left - PAD.right;
const PLOT_H = SVG_H - PAD.top - PAD.bottom;

// log2 scale helpers
const toLog = (v: number) => Math.log2(v);

function yPos(freq: number, minLog: number, maxLog: number): number {
  return PLOT_H - ((toLog(freq) - minLog) / (maxLog - minLog)) * PLOT_H;
}

export default function FreqChart({ data, onSelectNote }: FreqChartProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<string | null>(null);

  if (!data.length) return null;

  const freqs = data.map((d) => d.freq);
  const minLog = toLog(Math.min(...freqs) * 0.92);
  const maxLog = toLog(Math.max(...freqs) * 1.05);

  const barW = Math.floor(PLOT_W / data.length * 0.6);
  const step = PLOT_W / data.length;

  // Y-axis ticks: round Hz values that fall inside the range
  const yTicks = [200, 220, 246, 261, 293, 329, 349, 392, 440, 494, 523].filter(
    (v) => toLog(v) >= minLog && toLog(v) <= maxLog,
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ width: '100%', display: 'block', fontFamily: 'inherit' }}
      >
        {/* Y-axis ticks */}
        {yTicks.map((v) => {
          const y = PAD.top + yPos(v, minLog, maxLog);
          return (
            <g key={v}>
              <line
                x1={PAD.left - 4}
                x2={PAD.left + PLOT_W}
                y1={y}
                y2={y}
                stroke="#e8e8e8"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="#999"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Y-axis label */}
        <text
          x={12}
          y={PAD.top + PLOT_H / 2}
          textAnchor="middle"
          fontSize={10}
          fill="#999"
          transform={`rotate(-90, 12, ${PAD.top + PLOT_H / 2})`}
        >
          {t('noteSolfege.freqChartYAxis')}
        </text>

        {/* Axis border */}
        <line
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={PAD.top + PLOT_H}
          stroke="#d0d0d0"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke="#d0d0d0"
          strokeWidth={1}
        />

        {/* Bars */}
        {data.map((d, i) => {
          const cx = PAD.left + step * i + step / 2;
          const barX = cx - barW / 2;
          const barY = PAD.top + yPos(d.freq, minLog, maxLog);
          const barH = PAD.top + PLOT_H - barY;
          const isSelected = d.isSelected === 'selected';
          const isHov = hovered === d.pitchClass;
          const fill = isSelected ? '#7c3aed' : isHov ? '#a78bfa' : '#bfaef9';
          const tooltipTitle = `${d.freq} Hz  ·  ${t('noteSolfege.ratioLabel')}: ${d.ratioLabel}`;

          return (
            <Tooltip key={d.pitchClass} title={tooltipTitle}>
              <g
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectNote(d.pitchClass)}
                onMouseEnter={() => setHovered(d.pitchClass)}
                onMouseLeave={() => setHovered(null)}
              >
                <rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={barH}
                  fill={fill}
                  rx={3}
                  ry={3}
                />
                {/* Freq label on top */}
                <text
                  x={cx}
                  y={barY - 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isSelected ? '#7c3aed' : '#999'}
                  fontWeight={isSelected ? 700 : 400}
                >
                  {d.freq}
                </text>
                {/* X label */}
                <text
                  x={cx}
                  y={PAD.top + PLOT_H + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill={isSelected ? '#7c3aed' : '#555'}
                  fontWeight={isSelected ? 700 : 400}
                >
                  {d.note}
                </text>
              </g>
            </Tooltip>
          );
        })}
      </svg>
    </div>
  );
}

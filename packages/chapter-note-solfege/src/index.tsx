/**
 * Chapter 1: Note Names vs. Solfège
 * 音名与唱名：固定身份与可移动称呼
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Typography,
  Card,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Divider,
  Alert,
  Descriptions,
} from "antd";
import { InfoCircleOutlined, SoundOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  COMMON_MAJOR_KEYS,
  buildMappingRows,
  buildKeyboardLabels,
  buildFreqChartData,
  majorScaleNotes,
  normalizeToSharpPC,
  intervalFromTonic,
  intervalFromTonicEn,
  useAudio,
  type CommonMajorKey,
} from "@ezmusic/shared";

import { PianoKeyboard } from "@ezmusic/shared";
import MappingTable from "./components/MappingTable";
import FreqChart from "./components/FreqChart";
import IntervalDrill from "./components/IntervalDrill";
export { IntervalDrill as NoteSolfegeIntervalDrill };

const { Title, Paragraph, Text } = Typography;

export default function ChapterNoteSolfege() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === "zh-CN";

  const KEY_OPTIONS = COMMON_MAJOR_KEYS.map((k) => ({
    value: k,
    label: isZh ? `${k} 大调` : `${k} Major`,
  }));
  const { playNote } = useAudio();

  const [key, setKey] = useState<CommonMajorKey>("C");
  // Track the active note with octave so C4 and C5 are distinct
  const [activeNote, setActiveNote] = useState<string>("C4");

  // Reset to tonic when key changes
  useEffect(() => {
    setActiveNote(normalizeToSharpPC(key) + "4");
  }, [key]);

  // Pitch class derived from the active note (strips octave digit)
  const activePC = useMemo(
    () => activeNote.replace(/[0-9]/g, ""),
    [activeNote],
  );

  // Derived data – all pure calculations from shared
  const mappingRows = useMemo(() => buildMappingRows(key, false), [key]);
  const keyboardLabels = useMemo(() => buildKeyboardLabels(key, false), [key]);
  const freqData = useMemo(
    () => buildFreqChartData(key, false, activePC),
    [key, activePC],
  );
  const scaleNotes = useMemo(() => majorScaleNotes(key), [key]);
  const inScaleSet = useMemo(
    () => new Set(scaleNotes.map(normalizeToSharpPC)),
    [scaleNotes],
  );

  // Find what Do maps to (tonic note name) and what C maps to in the current key
  const tonicPC = key;
  const cSolfege = useMemo(() => {
    const row = mappingRows.find((r) => r.pitchClass === "C");
    return row ? row.solfege : "—";
  }, [mappingRows]);

  // Dynamic formula display (top section) — removed

  const handleKeyPress = useCallback(
    (_pitchClass: string, note: string) => {
      setActiveNote(note);
      playNote(note);
    },
    [playNote],
  );

  const handleChartSelect = useCallback(
    (pitchClass: string) => {
      const note = pitchClass + "4";
      setActiveNote(note);
      playNote(note);
    },
    [playNote],
  );

  // Selected note details (always defined since activeNote is always set)
  const selectedLabel = keyboardLabels.get(activePC) ?? null;
  // C5 is one octave above the stored C4 freq
  const activeFreq =
    activeNote === "C5"
      ? parseFloat(((selectedLabel?.freq ?? 0) * 2).toFixed(2))
      : (selectedLabel?.freq ?? 0);
  const selectedInterval = isZh
    ? intervalFromTonic(key, activePC)
    : intervalFromTonicEn(key, activePC);

  // Teaching hint text
  const teachingHint =
    key === "C"
      ? t("noteSolfege.teachingHintC")
      : t("noteSolfege.teachingHintOther", {
          key,
          tonicNote: tonicPC,
          cSolfege,
        });

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
          borderRadius: 16,
          padding: "48px 40px",
          marginBottom: 40,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -30,
            right: -20,
            fontSize: 160,
            opacity: 0.08,
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          ♪
        </div>
        <Title
          level={1}
          style={{ color: "#fff", marginBottom: 12, fontSize: 32 }}
        >
          {t("noteSolfege.chapterTitle")}
        </Title>
      </div>

      {/* ── Section 1: Concept Cards ─────────────────────────── */}
      <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
        {/* Note Name card */}
        <Col xs={24} md={12}>
          <Card
            style={{
              height: "100%",
              borderRadius: 12,
              borderColor: "#7c3aed",
              borderWidth: 2,
            }}
            styles={{ body: { padding: 24 } }}
          >
            <Space align="start" size={16}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
                  C
                </Text>
              </div>
              <div>
                <Title
                  level={4}
                  style={{ marginBottom: 4, marginTop: 0, color: "#7c3aed" }}
                >
                  {t("noteSolfege.conceptCardNote")}
                </Title>
                <Text
                  type="secondary"
                  style={{ fontSize: 13, display: "block", marginBottom: 8 }}
                >
                  {t("noteSolfege.conceptCardNoteDesc")}
                </Text>
                <Paragraph style={{ marginBottom: 0 }}>
                  {t("noteSolfege.conceptCardNoteDetail")}
                </Paragraph>
              </div>
            </Space>
          </Card>
        </Col>

        {/* Solfège card */}
        <Col xs={24} md={12}>
          <Card
            style={{
              height: "100%",
              borderRadius: 12,
              borderColor: "#f59e0b",
              borderWidth: 2,
            }}
            styles={{ body: { padding: 24 } }}
          >
            <Space align="start" size={16}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "linear-gradient(135deg,#f59e0b,#d97706)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>
                  Do
                </Text>
              </div>
              <div>
                <Title level={4} style={{ marginBottom: 4, marginTop: 0, color: "#d97706" }}>
                  {t("noteSolfege.conceptCardSolfege")}
                </Title>
                <Text
                  type="secondary"
                  style={{ fontSize: 13, display: "block", marginBottom: 8 }}
                >
                  {t("noteSolfege.conceptCardSolfegeDesc")}
                </Text>
                <Paragraph style={{ marginBottom: 0 }}>
                  {t("noteSolfege.conceptCardSolfegeDetail")}
                </Paragraph>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ── Teaching hint ─────────────────────────────────────── */}
      <Alert
        type="info"
        icon={<InfoCircleOutlined />}
        showIcon
        message={teachingHint}
        style={{ marginBottom: 32, borderRadius: 10 }}
      />

      <Divider />

      {/* ── Section 2: Controls ───────────────────────────────── */}
      <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Space>
            <Text strong>{t("noteSolfege.keySelector")}：</Text>
            <Select
              value={key}
              onChange={(v) => {
                setKey(v as CommonMajorKey);
              }}
              options={KEY_OPTIONS}
              style={{ width: 180 }}
            />
          </Space>
        </Col>
        {activePC && (
          <Col>
            <Tag
              icon={<SoundOutlined />}
              color="purple"
              style={{ fontSize: 13, padding: "4px 10px" }}
            >
              {activePC}
            </Tag>
          </Col>
        )}
      </Row>

      {/* ── Section 2: Piano + Mapping ────────────────────────── */}
      <Row
        gutter={[32, 32]}
        style={{ marginBottom: 32, alignItems: "stretch" }}
      >
        <Col
          xs={24}
          lg={15}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <Card
            title={
              <Space>
                <span>🎹</span>
                <span>{t("noteSolfege.pianoTitle")}</span>
              </Space>
            }
            style={{ borderRadius: 12, flex: 1 }}
            styles={{ body: { padding: "16px 12px" } }}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("noteSolfege.pianoHint")}
              </Text>
            }
          >
            <PianoKeyboard
              labels={keyboardLabels}
              activeNote={activeNote}
              inScaleSet={inScaleSet}
              onKeyPress={handleKeyPress}
            />

            {/* Selected note detail – always visible */}
            <div
              style={{
                marginTop: 16,
                padding: "12px 16px",
                background: "#f5f3ff",
                borderRadius: 10,
              }}
            >
              <Descriptions
                size="small"
                column={{ xs: 2, sm: 4 }}
                items={[
                  {
                    label: t("noteSolfege.noteLabel"),
                    children: (
                      <Text strong style={{ color: "#7c3aed" }}>
                        {selectedLabel?.pitchClass ?? activePC}
                      </Text>
                    ),
                  },
                  {
                    label: t("noteSolfege.solfegeLabel"),
                    children: (
                      <Text strong>{selectedLabel?.solfege ?? "—"}</Text>
                    ),
                  },
                  {
                    label: t("noteSolfege.freqLabel"),
                    children: `${activeFreq} Hz`,
                  },
                  {
                    label: t("noteSolfege.intervalLabel"),
                    children: selectedLabel?.isTonic ? (
                      <Tag color="purple">{t("noteSolfege.tonicBadge")}</Tag>
                    ) : (
                      selectedInterval || "—"
                    ),
                  },
                  {
                    label: isZh ? "在音阶中" : "In scale",
                    children: inScaleSet.has(activePC) ? (
                      <Tag color="success">{t("noteSolfege.inScaleYes")}</Tag>
                    ) : (
                      <Tag color="default">{t("noteSolfege.inScaleNo")}</Tag>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        </Col>

        <Col
          xs={24}
          lg={9}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <Card
            title={t("noteSolfege.mappingTableTitle")}
            style={{ borderRadius: 12, flex: 1 }}
            styles={{ body: { padding: 16 } }}
          >
            <MappingTable rows={mappingRows} activePC={activePC} />
          </Card>
        </Col>
      </Row>

      {/* ── Section 3: Frequency Chart ───────────────────────── */}
      <Card
        title={
          <Space>
            <span>📊</span>
            <span>{t("noteSolfege.freqChartTitle")}</span>
          </Space>
        }
        extra={
          <Text type="secondary" style={{ fontSize: 12, maxWidth: 360 }}>
            {t("noteSolfege.freqChartHint")}
          </Text>
        }
        style={{ borderRadius: 12, marginBottom: 32 }}
      >
        <FreqChart data={freqData} onSelectNote={handleChartSelect} />
      </Card>

      {/* ── Section 4: Whole / Half Step ─────────────────────── */}
      <Card
        title={
          <Space>
            <span>📏</span>
            <span>
              {isZh
                ? "全音与半音：音阶的构建块"
                : "Whole & Half Steps: Scale Building Blocks"}
            </span>
          </Space>
        }
        style={{ borderRadius: 12, marginBottom: 32 }}
      >
        <Paragraph style={{ color: "#555", marginBottom: 24 }}>
          {isZh
            ? "半音（H）是钢琴上相邻两键的最小距离。全音（W）= 2 个半音。大调音阶严格按照 全–全–半–全–全–全–半 排列，无论起点在哪个音上。E→F 和 B→C 之间没有黑键，因此是天然的半音位置。"
            : "A half step (H) is the smallest interval — the distance between two adjacent keys. A whole step (W) = 2 half steps. Every major scale follows the fixed pattern W–W–H–W–W–W–H. E→F and B→C have no black key between them, making them natural half-step positions."}
        </Paragraph>

        {/* Scale strip: note boxes connected by W/H step labels */}
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: "max-content",
              padding: "8px 4px",
            }}
          >
            {[
              ...["C","D","E","F","G","A","B"].map((pc) => ({ pitchClass: pc })).flatMap((row, i) => {
                const noteEl = (
                  <div
                    key={`sn-${i}`}
                    style={{
                      width: 52,
                      height: 48,
                      borderRadius: 10,
                      flexShrink: 0,
                      background:
                        i === 0
                          ? "linear-gradient(135deg,#7c3aed,#4f46e5)"
                          : "#f5f3ff",
                      border: `2px solid ${i === 0 ? "#7c3aed" : "#c4b5fd"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: i === 0 ? "#fff" : "#7c3aed",
                      }}
                    >
                      {row.pitchClass}
                    </span>
                  </div>
                );
                if (i < 6) {
                  const isHalf = [2, 2, 1, 2, 2, 2][i] === 1;
                  const stepEl = (
                    <div
                      key={`ss-${i}`}
                      style={{
                        width: isHalf ? 38 : 48,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          borderRadius: 6,
                          padding: "2px 7px",
                          color: isHalf ? "#d97706" : "#7c3aed",
                          background: isHalf ? "#fef3c7" : "#ede9fe",
                        }}
                      >
                        {isHalf ? (isZh ? "半" : "H") : isZh ? "全" : "W"}
                      </div>
                      <div style={{ fontSize: 9, color: "#bbb" }}>
                        {isHalf ? "1" : "2"}
                      </div>
                    </div>
                  );
                  return [noteEl, stepEl];
                }
                return [noteEl];
              }),
              // Final half step to octave
              <div
                key="ss-6"
                style={{
                  width: 38,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#d97706",
                    background: "#fef3c7",
                    borderRadius: 6,
                    padding: "2px 7px",
                  }}
                >
                  {isZh ? "半" : "H"}
                </div>
                <div style={{ fontSize: 9, color: "#bbb" }}>1</div>
              </div>,
              // Octave root
              <div
                key="sn-oct"
                style={{
                  width: 52,
                  height: 48,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                  border: "2px solid #7c3aed",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  opacity: 0.55,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                  C
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)" }}>
                  +8va
                </span>
              </div>,
            ]}
          </div>
        </div>

        <Divider style={{ margin: "20px 0 16px" }} />
        <Space size="large" wrap>
          <Space>
            <div
              style={{
                width: 28,
                height: 22,
                borderRadius: 5,
                background: "#ede9fe",
                border: "1px solid #c4b5fd",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed" }}>
                {isZh ? "全" : "W"}
              </Text>
            </div>
            <Text style={{ fontSize: 13, color: "#555" }}>
              {isZh
                ? "全音（W）= 2 个半音，音符之间隔一个黑键，如 C → D"
                : "Whole step (W) = 2 semitones, e.g. C → D"}
            </Text>
          </Space>
          <Space>
            <div
              style={{
                width: 28,
                height: 22,
                borderRadius: 5,
                background: "#fef3c7",
                border: "1px solid #fcd34d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: 800, color: "#d97706" }}>
                {isZh ? "半" : "H"}
              </Text>
            </div>
            <Text style={{ fontSize: 13, color: "#555" }}>
              {isZh
                ? "半音（H）= 最小音程，E → F 和 B → C 之间无黑键"
                : "Half step (H) = 1 semitone, e.g. E → F or B → C"}
            </Text>
          </Space>
        </Space>
      </Card>

      {/* ── Section 5: Interval Speed Drill ─────────────────── */}
      <IntervalDrill />
    </div>
  );
}

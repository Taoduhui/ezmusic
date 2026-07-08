/**
 * Solfège ↔ Note Name mapping table.
 */
import { Table, Tag } from '@ezmusic/shared';
import type { MappingRow } from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';

interface MappingTableProps {
  rows: MappingRow[];
  activePC: string | null;
}

export default function MappingTable({ rows, activePC }: MappingTableProps) {
  const { t } = useTranslation();

  const columns = [
    {
      title: t('noteSolfege.mappingColSolfege'),
      dataIndex: 'solfege',
      key: 'solfege',
      render: (val: string, row: MappingRow) => (
        <span style={{ fontWeight: row.pitchClass === activePC ? 700 : 400, color: row.pitchClass === activePC ? '#7c3aed' : undefined }}>
          {val}
        </span>
      ),
    },
    {
      title: t('noteSolfege.mappingColNote'),
      dataIndex: 'pitchClass',
      key: 'pitchClass',
      render: (val: string, row: MappingRow) => (
        <span>
          <Tag
            color={row.pitchClass === activePC ? 'purple' : row.hasAccidental ? 'orange' : 'default'}
            style={{ fontFamily: 'monospace', fontWeight: 600 }}
          >
            {val}
          </Tag>
        </span>
      ),
    },
  ];

  return (
    <Table
      dataSource={rows.map((r) => ({ ...r, key: r.degree }))}
      columns={columns}
      size="small"
      style={{ borderRadius: 8, overflow: 'hidden' }}
      rowClassName={(row) =>
        (row as MappingRow).pitchClass === activePC ? 'mapping-row-active' : ''
      }
    />
  );
}

import * as React from 'react';
import { cn } from './cn';

export interface TableColumn<T> {
  title: React.ReactNode;
  dataIndex: string;
  key?: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

export interface TableProps<T> {
  dataSource: T[];
  columns: TableColumn<T>[];
  size?: 'small' | 'default';
  className?: string;
  style?: React.CSSProperties;
  rowClassName?: (row: T, index: number) => string;
  rowKey?: keyof T & string;
}

/** Lightweight data table (antd Table-compatible subset). */
export function Table<T extends { key?: React.Key }>({
  dataSource,
  columns,
  size = 'default',
  className,
  style,
  rowClassName,
  rowKey = 'key' as keyof T & string,
}: TableProps<T>) {
  const pad = size === 'small' ? 'px-3 py-1.5' : 'px-4 py-2.5';
  return (
    <div
      className={cn('w-full overflow-hidden rounded-lg border border-border', className)}
      style={style}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/60">
            {columns.map((col) => (
              <th
                key={col.key ?? col.dataIndex}
                className={cn(
                  pad,
                  'text-left font-medium text-muted-foreground',
                  col.align === 'center' && 'text-center',
                  col.align === 'right' && 'text-right',
                )}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataSource.map((row, i) => (
            <tr
              key={String(row[rowKey] ?? i)}
              className={cn('border-t border-border', rowClassName?.(row, i))}
            >
              {columns.map((col) => (
                <td
                  key={col.key ?? col.dataIndex}
                  className={cn(
                    pad,
                    col.align === 'center' && 'text-center',
                    col.align === 'right' && 'text-right',
                  )}
                >
                  {col.render
                    ? col.render((row as any)[col.dataIndex], row, i)
                    : ((row as any)[col.dataIndex] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

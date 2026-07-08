import * as React from 'react';
import { cn } from './cn';

type SpaceSize = number | 'small' | 'middle' | 'large';

const sizeMap: Record<string, number> = { small: 8, middle: 16, large: 24 };

function resolveSize(size: SpaceSize | [SpaceSize, SpaceSize]): string {
  const toPx = (s: SpaceSize) => (typeof s === 'number' ? s : sizeMap[s] ?? 8);
  if (Array.isArray(size)) return `${toPx(size[1])}px ${toPx(size[0])}px`;
  return `${toPx(size)}px`;
}

export interface SpaceProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'horizontal' | 'vertical';
  size?: SpaceSize | [SpaceSize, SpaceSize];
  align?: 'start' | 'end' | 'center' | 'baseline';
  wrap?: boolean;
}

/** Flexbox spacing container (antd Space-compatible subset). */
export const Space = React.forwardRef<HTMLDivElement, SpaceProps>(
  ({ className, direction = 'horizontal', size = 'small', align, wrap, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex',
        direction === 'vertical' ? 'flex-col' : 'flex-row',
        direction === 'horizontal' && !align ? 'items-center' : '',
        align === 'start' && 'items-start',
        align === 'end' && 'items-end',
        align === 'center' && 'items-center',
        align === 'baseline' && 'items-baseline',
        wrap && 'flex-wrap',
        className,
      )}
      style={{ gap: resolveSize(size), ...style }}
      {...props}
    />
  ),
);
Space.displayName = 'Space';

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  gutter?: number | [number, number];
  align?: 'top' | 'middle' | 'bottom';
  justify?: 'start' | 'end' | 'center' | 'space-between' | 'space-around';
}

export const Row = React.forwardRef<HTMLDivElement, RowProps>(
  ({ className, gutter = 0, align, justify, style, ...props }, ref) => {
    const [gx, gy] = Array.isArray(gutter) ? gutter : [gutter, 0];
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap',
          align === 'top' && 'items-start',
          align === 'middle' && 'items-center',
          align === 'bottom' && 'items-end',
          justify === 'center' && 'justify-center',
          justify === 'end' && 'justify-end',
          justify === 'space-between' && 'justify-between',
          justify === 'space-around' && 'justify-around',
          className,
        )}
        style={{ columnGap: gx, rowGap: gy, ...style }}
        {...props}
      />
    );
  },
);
Row.displayName = 'Row';

export interface ColProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column span out of 24 (antd grid). */
  span?: number;
  flex?: string | number;
  /** Responsive spans. On mobile the `xs` span drives the width (single-column layout). */
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export const Col = React.forwardRef<HTMLDivElement, ColProps>(
  ({ className, span, flex, xs, sm, md, lg, xl, style, ...props }, ref) => {
    // Mobile-first: prefer the `xs` span, then explicit `span`, else full width.
    const effectiveSpan = xs ?? span;
    return (
      <div
        ref={ref}
        className={className}
        style={{
          ...(effectiveSpan != null ? { width: `${(effectiveSpan / 24) * 100}%` } : {}),
          ...(flex != null ? { flex } : {}),
          ...style,
        }}
        {...props}
      />
    );
  },
);
Col.displayName = 'Col';

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'horizontal' | 'vertical';
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ className, direction = 'horizontal', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        direction === 'vertical'
          ? 'mx-2 inline-block h-4 w-px bg-border align-middle'
          : 'my-3 h-px w-full bg-border',
        className,
      )}
      {...props}
    />
  ),
);
Divider.displayName = 'Divider';

import * as React from 'react';
import { cn } from './cn';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0 – 100 */
  percent?: number;
  showInfo?: boolean;
  /** Custom fill color (CSS color). Defaults to the primary theme color. */
  strokeColor?: string;
  size?: 'default' | 'small';
  /** Custom info renderer (antd-compatible). */
  format?: (percent?: number) => React.ReactNode;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, percent = 0, showInfo = false, strokeColor, size = 'default', format, ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const showLabel = format != null || showInfo;
    return (
      <div ref={ref} className={cn('flex items-center gap-2', className)} {...props}>
        <div
          className={cn(
            'relative w-full overflow-hidden rounded-full bg-secondary',
            size === 'small' ? 'h-1.5' : 'h-2.5',
          )}
        >
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{
              width: `${clamped}%`,
              backgroundColor: strokeColor ?? 'hsl(var(--primary))',
            }}
          />
        </div>
        {showLabel && (
          <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {format ? format(clamped) : `${Math.round(clamped)}%`}
          </span>
        )}
      </div>
    );
  },
);
Progress.displayName = 'Progress';

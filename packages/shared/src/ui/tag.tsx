import * as React from 'react';
import { cn } from './cn';

/** Preset color → utility classes. Unknown values fall back to inline color. */
const presetClass: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground border-transparent',
  primary: 'bg-primary/10 text-primary border-primary/20',
  processing: 'bg-primary/10 text-primary border-primary/20',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  success: 'bg-success/10 text-success border-success/20',
  green: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  gold: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  red: 'bg-destructive/10 text-destructive border-destructive/20',
};

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string;
  /** Leading icon element. */
  icon?: React.ReactNode;
}

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, color, icon, style, children, ...props }, ref) => {
    const preset = color ? presetClass[color] : presetClass.default;
    const useInline = color && !preset;
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
          preset ?? 'border-transparent text-white',
          className,
        )}
        style={useInline ? { backgroundColor: color, ...style } : style}
        {...props}
      >
        {icon}
        {children}
      </span>
    );
  },
);
Tag.displayName = 'Tag';

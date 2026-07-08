import * as React from 'react';
import { cn } from './cn';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header title (convenience for simple cards). */
  title?: React.ReactNode;
  /** Optional header trailing content. */
  extra?: React.ReactNode;
  /** Compact padding. */
  compact?: boolean;
  /** antd size compatibility ('small' → compact). */
  size?: 'small' | 'default';
  /** antd `styles` slots — body/header inline styles. */
  styles?: { body?: React.CSSProperties; header?: React.CSSProperties };
  /** antd bodyStyle alias. */
  bodyStyle?: React.CSSProperties;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, title, extra, compact, size, styles, bodyStyle, children, ...props }, ref) => {
    const isCompact = compact ?? size === 'small';
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
          className,
        )}
        {...props}
      >
        {(title || extra) && (
          <div
            className={cn(
              'flex items-center justify-between gap-2 border-b border-border',
              isCompact ? 'px-3 py-2' : 'px-4 py-3',
            )}
            style={styles?.header}
          >
            {title && <div className="font-semibold">{title}</div>}
            {extra}
          </div>
        )}
        <div className={cn(isCompact ? 'p-3' : 'p-4')} style={styles?.body ?? bodyStyle}>
          {children}
        </div>
      </div>
    );
  },
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

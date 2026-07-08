import * as React from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from './cn';

type AlertType = 'info' | 'success' | 'warning' | 'error';

const typeStyles: Record<AlertType, { box: string; icon: React.ReactNode }> = {
  info: {
    box: 'bg-primary/5 border-primary/20 text-foreground',
    icon: <Info className="h-4 w-4 text-primary" />,
  },
  success: {
    box: 'bg-success/5 border-success/20 text-foreground',
    icon: <CheckCircle2 className="h-4 w-4 text-success" />,
  },
  warning: {
    box: 'bg-warning/5 border-warning/20 text-foreground',
    icon: <AlertTriangle className="h-4 w-4 text-warning" />,
  },
  error: {
    box: 'bg-destructive/5 border-destructive/20 text-foreground',
    icon: <XCircle className="h-4 w-4 text-destructive" />,
  },
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: React.ReactNode;
  description?: React.ReactNode;
  type?: AlertType;
  showIcon?: boolean;
  /** Custom leading icon (overrides the default type icon). */
  icon?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, message, description, type = 'info', showIcon = false, icon, children, ...props }, ref) => {
    const styles = typeStyles[type];
    return (
      <div
        ref={ref}
        role="alert"
        className={cn('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', styles.box, className)}
        {...props}
      >
        {showIcon && <span className="mt-0.5 shrink-0">{icon ?? styles.icon}</span>}
        <div className="min-w-0 flex-1">
          {message && <div className="font-medium">{message}</div>}
          {description && (
            <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
          )}
          {children}
        </div>
      </div>
    );
  },
);
Alert.displayName = 'Alert';

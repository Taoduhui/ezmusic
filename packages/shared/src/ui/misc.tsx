import * as React from 'react';
import { cn } from './cn';
import { Button } from './button';
import { ChevronDownIcon } from './icons';

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

export interface DescriptionItem {
  key?: React.Key;
  label: React.ReactNode;
  children: React.ReactNode;
}

export interface DescriptionsProps {
  items: DescriptionItem[];
  /** Columns per row. Number or a responsive map (only `xs`/`sm` honoured). */
  column?: number | { xs?: number; sm?: number; md?: number };
  size?: 'small' | 'default';
  className?: string;
}

export function Descriptions({ items, column = 2, size = 'default', className }: DescriptionsProps) {
  const cols = typeof column === 'number' ? column : column.sm ?? column.md ?? column.xs ?? 2;
  const xsCols = typeof column === 'number' ? column : column.xs ?? 2;
  return (
    <dl
      className={cn(
        'grid gap-x-4 gap-y-2',
        size === 'small' ? 'text-sm' : 'text-base',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(var(--desc-cols, ${xsCols}), minmax(0, 1fr))` }}
    >
      <style>{`@media(min-width:576px){dl{--desc-cols:${cols}}}`}</style>
      {items.map((item, i) => (
        <div key={item.key ?? i} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="m-0 font-medium">{item.children}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Collapse (accordion)                                                */
/* ------------------------------------------------------------------ */

export interface CollapseItem {
  key: string;
  label: React.ReactNode;
  children: React.ReactNode;
}

export interface CollapseProps {
  items: CollapseItem[];
  defaultActiveKey?: string | string[];
  /** Controlled active keys. */
  activeKey?: string | string[];
  onChange?: (keys: string[]) => void;
  ghost?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Collapse({
  items,
  defaultActiveKey = [],
  activeKey,
  onChange,
  ghost,
  className,
  style,
}: CollapseProps) {
  const initial = Array.isArray(defaultActiveKey) ? defaultActiveKey : [defaultActiveKey];
  const [internal, setInternal] = React.useState<string[]>(initial);

  const controlled = activeKey !== undefined;
  const active = controlled
    ? Array.isArray(activeKey)
      ? activeKey
      : [activeKey as string]
    : internal;

  const toggle = (key: string) => {
    const next = active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        !ghost && 'divide-y divide-border rounded-lg border border-border',
        className,
      )}
      style={style}
    >
      {items.map((item) => {
        const open = active.includes(item.key);
        return (
          <div key={item.key} className={cn(!ghost && 'first:rounded-t-lg last:rounded-b-lg')}>
            <button
              type="button"
              onClick={() => toggle(item.key)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium"
            >
              {item.label}
              <ChevronDownIcon
                className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
              />
            </button>
            {open && <div className="px-3 pb-3 pt-0 text-sm">{item.children}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popconfirm                                                          */
/* ------------------------------------------------------------------ */

export interface PopconfirmProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
  okText?: React.ReactNode;
  cancelText?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactElement;
}

export function Popconfirm({
  title,
  description,
  onConfirm,
  onCancel,
  okText = 'OK',
  cancelText = 'Cancel',
  disabled,
  children,
}: PopconfirmProps) {
  const [open, setOpen] = React.useState(false);

  const trigger = React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      if (!disabled) setOpen((o) => !o);
    },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="text-sm font-medium">{title}</div>
            {description && (
              <div className="mt-1 text-xs text-muted-foreground">{description}</div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  onCancel?.();
                }}
              >
                {cancelText}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onConfirm?.();
                }}
              >
                {okText}
              </Button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

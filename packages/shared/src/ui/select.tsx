import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check } from 'lucide-react';
import { cn } from './cn';
import { ChevronDownIcon } from './icons';

export interface SelectOption {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string | number | Array<string | number>;
  defaultValue?: string | number;
  /** Called with the original (typed) option value, or an array in multiple mode. */
  onChange?: (value: any) => void;
  options: SelectOption[];
  placeholder?: React.ReactNode;
  disabled?: boolean;
  size?: 'default' | 'small' | 'large';
  className?: string;
  /** Alias kept for convenience; merged into className. */
  style?: React.CSSProperties;
  /** antd multi-select mode. */
  mode?: 'multiple' | 'tags';
  /** Ignored (antd compatibility). */
  maxTagCount?: number;
  showSearch?: boolean;
  optionFilterProp?: string;
  'aria-label'?: string;
}

const sizeClass: Record<NonNullable<SelectProps['size']>, string> = {
  small: 'h-9 text-sm',
  default: 'h-11 text-sm',
  large: 'h-12 text-base',
};

/** Radix-based select with an antd-compatible `options`/`value`/`onChange` API. */
export function Select({
  value,
  defaultValue,
  onChange,
  options,
  placeholder,
  disabled,
  size = 'default',
  className,
  style,
  mode,
  ...rest
}: SelectProps) {
  if (mode === 'multiple' || mode === 'tags') {
    return (
      <MultiSelect
        value={(Array.isArray(value) ? value : value != null ? [value] : []) as Array<string | number>}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        size={size}
        className={className}
        style={style}
      />
    );
  }

  const toStr = (v: string | number | Array<string | number> | undefined) =>
    v == null || Array.isArray(v) ? undefined : String(v);

  const handleChange = (str: string) => {
    const match = options.find((o) => String(o.value) === str);
    onChange?.(match ? match.value : str);
  };

  return (
    <SelectPrimitive.Root
      value={toStr(value)}
      defaultValue={toStr(defaultValue)}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
          sizeClass[size],
          className,
        )}
        style={style}
        aria-label={rest['aria-label']}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon className="h-4 w-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 w-[var(--radix-select-trigger-width)]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={String(opt.value)}
                value={String(opt.value)}
                disabled={opt.disabled}
                className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

interface MultiSelectProps {
  value: Array<string | number>;
  onChange?: (value: any) => void;
  options: SelectOption[];
  placeholder?: React.ReactNode;
  disabled?: boolean;
  size?: 'default' | 'small' | 'large';
  className?: string;
  style?: React.CSSProperties;
}

/** Lightweight multi-select (checkable dropdown) with an antd-compatible array API. */
function MultiSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size = 'default',
  className,
  style,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (v: string | number) => {
    const has = value.some((x) => String(x) === String(v));
    const next = has ? value.filter((x) => String(x) !== String(v)) : [...value, v];
    onChange?.(next);
  };

  const selectedLabels = options
    .filter((o) => value.some((x) => String(x) === String(o.value)))
    .map((o) => o.label);

  return (
    <div ref={ref} className={cn('relative', className)} style={style}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          sizeClass[size],
        )}
      >
        <span className="flex flex-1 flex-wrap gap-1 overflow-hidden">
          {selectedLabels.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selectedLabels.map((label, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
              >
                {label}
              </span>
            ))
          )}
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((opt) => {
            const checked = value.some((x) => String(x) === String(opt.value));
            return (
              <button
                key={String(opt.value)}
                type="button"
                disabled={opt.disabled}
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

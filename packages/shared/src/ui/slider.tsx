import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from './cn';

type SliderValue = number | number[];

export interface SliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
    'value' | 'defaultValue' | 'onValueChange' | 'onValueCommit' | 'onChange'
  > {
  /** Enable two-thumb range mode. */
  range?: boolean;
  /** Single number, or `[start, end]` array in range mode (antd-compatible). */
  value?: SliderValue;
  defaultValue?: SliderValue;
  /** Called while dragging with a number (single) or `[start, end]` (range). */
  onChange?: (value: any) => void;
  /** Called when the drag ends. */
  onChangeComplete?: (value: any) => void;
  /** Ignored antd compatibility props. */
  marks?: Record<number, React.ReactNode>;
  styles?: { track?: React.CSSProperties; rail?: React.CSSProperties; handle?: React.CSSProperties };
  tooltip?: any;
}

const toArray = (v: SliderValue | undefined): number[] | undefined => {
  if (v == null) return undefined;
  return Array.isArray(v) ? v : [v];
};

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, range, value, defaultValue, onChange, onChangeComplete, marks, styles, tooltip, ...props }, ref) => {
  const emit = (cb: ((v: any) => void) | undefined) => (v: number[]) =>
    cb?.(range || Array.isArray(value) || Array.isArray(defaultValue) ? v : v[0]);

  const arr = toArray(value);
  const thumbCount = range ? 2 : (arr?.length ?? toArray(defaultValue)?.length ?? 1);

  return (
    <SliderPrimitive.Root
      ref={ref}
      value={arr}
      defaultValue={toArray(defaultValue)}
      onValueChange={onChange ? emit(onChange) : undefined}
      onValueCommit={onChangeComplete ? emit(onChangeComplete) : undefined}
      className={cn(
        'relative flex w-full touch-none select-none items-center py-2',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slider-rail
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"
      >
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className="block h-5 w-5 rounded-full border-2 border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = 'Slider';

export { Slider };

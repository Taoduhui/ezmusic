import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from './cn';

export interface SwitchProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    'onChange' | 'checked' | 'defaultChecked'
  > {
  checked?: boolean;
  defaultChecked?: boolean;
  /** Called with the next checked state (antd-compatible signature). */
  onChange?: (checked: boolean) => void;
  /** Ignored antd compatibility props. */
  checkedChildren?: React.ReactNode;
  unCheckedChildren?: React.ReactNode;
  size?: 'default' | 'small';
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, checked, defaultChecked, onChange, checkedChildren, unCheckedChildren, size, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    checked={checked}
    defaultChecked={defaultChecked}
    onCheckedChange={onChange}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = 'Switch';

export { Switch };

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import { SpinnerIcon } from './icons';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-sm',
        lg: 'h-12 rounded-lg px-6 text-base',
        icon: 'h-11 w-11',
        'icon-sm': 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type AntType = 'primary' | 'default' | 'dashed' | 'text' | 'link';
type AntSize = 'small' | 'middle' | 'large';

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>,
    Omit<VariantProps<typeof buttonVariants>, 'size'> {
  asChild?: boolean;
  /** Show a spinner and disable the button. */
  loading?: boolean;
  /** Leading icon element. Hidden while loading. */
  icon?: React.ReactNode;
  /** Stretch to the full width of the container. */
  block?: boolean;
  /** Native button type or antd visual type (mapped to a variant). */
  type?: AntType | 'button' | 'submit' | 'reset';
  /** antd danger flag → destructive variant. */
  danger?: boolean;
  /** antd ghost flag → outline variant. */
  ghost?: boolean;
  size?: VariantProps<typeof buttonVariants>['size'] | AntSize;
  shape?: 'default' | 'circle' | 'round';
}

const antTypeToVariant: Record<AntType, NonNullable<VariantProps<typeof buttonVariants>['variant']>> = {
  primary: 'default',
  default: 'outline',
  dashed: 'outline',
  text: 'ghost',
  link: 'link',
};

const antSizeToSize: Record<string, VariantProps<typeof buttonVariants>['size']> = {
  small: 'sm',
  middle: 'default',
  large: 'lg',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading,
      icon,
      block,
      disabled,
      type,
      danger,
      ghost,
      shape,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    // Resolve variant from antd `type`/`danger`/`ghost` when no explicit variant given.
    let resolvedVariant = variant;
    if (!resolvedVariant) {
      if (danger) resolvedVariant = 'destructive';
      else if (ghost) resolvedVariant = 'outline';
      else if (type && type in antTypeToVariant) resolvedVariant = antTypeToVariant[type as AntType];
    }

    const resolvedSize =
      (size && size in antSizeToSize ? antSizeToSize[size as string] : size) ??
      (shape === 'circle' ? 'icon' : undefined);

    // Only forward `type` to the DOM when it's a native button type.
    const nativeType =
      type === 'button' || type === 'submit' || type === 'reset' ? type : undefined;

    return (
      <Comp
        className={cn(
          buttonVariants({ variant: resolvedVariant, size: resolvedSize as any }),
          block && 'w-full',
          shape === 'circle' && 'rounded-full',
          shape === 'round' && 'rounded-full',
          className,
        )}
        ref={ref}
        type={nativeType}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <SpinnerIcon spin className="h-4 w-4" /> : icon}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button };

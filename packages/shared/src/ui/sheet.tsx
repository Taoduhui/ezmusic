import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import { CloseOutlined } from './icons';

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-0 bg-background shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-300',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        right:
          'inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetProps extends VariantProps<typeof sheetVariants> {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** antd-compatible close callback. */
  onClose?: () => void;
  /** antd `placement` alias for `side`. */
  placement?: 'top' | 'right' | 'bottom' | 'left';
  title?: React.ReactNode;
  /** Show the header/close button. Defaults to true when a title is given. */
  showClose?: boolean;
  /** Width for left/right sheets (e.g. 300 or '80%'). */
  width?: number | string;
  /** Height for top/bottom sheets. */
  height?: number | string;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
  /* --- Ignored antd Drawer compatibility props (accepted, no-op) --- */
  styles?: { body?: React.CSSProperties; header?: React.CSSProperties; [k: string]: any };
  closeIcon?: React.ReactNode;
  maskClosable?: boolean;
  zIndex?: number;
}

export function Sheet({
  open,
  onOpenChange,
  onClose,
  side,
  placement,
  title,
  showClose,
  width,
  height,
  className,
  bodyClassName,
  children,
  styles,
  closeIcon: _closeIcon,
  maskClosable: _maskClosable,
  zIndex: _zIndex,
}: SheetProps) {
  const resolvedSide = side ?? placement ?? 'right';
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onClose?.();
  };

  const isHorizontal = resolvedSide === 'left' || resolvedSide === 'right';
  const style: React.CSSProperties = {};
  if (isHorizontal) {
    style.width = width ?? 'min(88vw, 320px)';
    style.maxWidth = '100vw';
  } else if (height != null) {
    style.maxHeight = height;
  }
  const withClose = showClose ?? true;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(sheetVariants({ side: resolvedSide }), className)}
          style={style}
          aria-describedby={undefined}
        >
          <div
            className="flex items-center justify-between gap-2 px-4 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <DialogPrimitive.Title
              className={cn('text-base font-semibold', !title && 'sr-only')}
            >
              {title ?? 'Menu'}
            </DialogPrimitive.Title>
            {withClose && (
              <DialogPrimitive.Close
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close"
              >
                <CloseOutlined className="h-5 w-5" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div
            className={cn('flex-1 overflow-y-auto p-4 pb-safe-bottom', bodyClassName)}
            style={styles?.body}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** antd Drawer-compatible alias. */
export const Drawer = Sheet;

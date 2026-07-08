import * as React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

/** Mount once near the app root. Positioned for mobile (top-center). */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      closeButton={false}
      toastOptions={{
        style: {
          marginTop: 'var(--safe-area-top, 0px)',
        },
      }}
    />
  );
}

/** Convert antd-style seconds duration to sonner milliseconds (0 = persist). */
function toMs(duration?: number): number | undefined {
  if (duration == null) return undefined;
  return duration === 0 ? Infinity : duration * 1000;
}

export interface MessageConfig {
  content: React.ReactNode;
  duration?: number;
  key?: string | number;
}

type MessageArg = React.ReactNode | MessageConfig;

function normalize(arg: MessageArg, duration?: number): { content: React.ReactNode; opts: any } {
  if (arg && typeof arg === 'object' && 'content' in (arg as any)) {
    const c = arg as MessageConfig;
    return { content: c.content, opts: { id: c.key, duration: toMs(c.duration) } };
  }
  return { content: arg as React.ReactNode, opts: { duration: toMs(duration) } };
}

/** antd `message`-compatible lightweight toast API. */
export const message = {
  success: (arg: MessageArg, duration?: number) => {
    const { content, opts } = normalize(arg, duration);
    return sonnerToast.success(content as string, opts);
  },
  error: (arg: MessageArg, duration?: number) => {
    const { content, opts } = normalize(arg, duration);
    return sonnerToast.error(content as string, opts);
  },
  info: (arg: MessageArg, duration?: number) => {
    const { content, opts } = normalize(arg, duration);
    return sonnerToast(content as string, opts);
  },
  warning: (arg: MessageArg, duration?: number) => {
    const { content, opts } = normalize(arg, duration);
    return sonnerToast.warning(content as string, opts);
  },
  loading: (arg: MessageArg, duration?: number) => {
    const { content, opts } = normalize(arg, duration);
    return sonnerToast.loading(content as string, opts);
  },
  destroy: (key?: string | number) => sonnerToast.dismiss(key),
};

export interface NotificationConfig {
  key?: string | number;
  message?: React.ReactNode;
  description?: React.ReactNode;
  /** Custom action node (e.g. an "update" button). */
  btn?: React.ReactNode;
  duration?: number;
  /** Ignored antd compatibility prop. */
  placement?: string;
}

function notify(
  variant: 'info' | 'success' | 'warning' | 'error',
  config: NotificationConfig,
) {
  const { key, message: title, description, btn, duration } = config;
  const body = (
    <div className="flex flex-col gap-1">
      {title && <div className="font-medium">{title}</div>}
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
      {btn && <div className="mt-1">{btn}</div>}
    </div>
  );
  const opts = { id: key, duration: toMs(duration) };
  switch (variant) {
    case 'success':
      return sonnerToast.success(body, opts);
    case 'warning':
      return sonnerToast.warning(body, opts);
    case 'error':
      return sonnerToast.error(body, opts);
    default:
      return sonnerToast(body, opts);
  }
}

/** antd `notification`-compatible API (subset used by the app). */
export const notification = {
  open: (config: NotificationConfig) => notify('info', config),
  info: (config: NotificationConfig) => notify('info', config),
  success: (config: NotificationConfig) => notify('success', config),
  warning: (config: NotificationConfig) => notify('warning', config),
  error: (config: NotificationConfig) => notify('error', config),
  destroy: (key?: string | number) => sonnerToast.dismiss(key),
};

/**
 * Icon set backed by lucide-react.
 *
 * These thin wrappers keep a stable, project-local icon API. Sizing follows
 * the shadcn convention (Tailwind height/width classes) but the wrappers also
 * honour an inline `style.fontSize` / `style.color` so they drop into existing
 * call sites cleanly.
 */
import * as React from 'react';
import {
  Volume2,
  VolumeX,
  X,
  RotateCw,
  Mic,
  MicOff,
  Menu,
  Settings,
  Check,
  Trophy,
  Flame,
  Info,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Music,
  type LucideIcon,
} from 'lucide-react';
import { cn } from './cn';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  /** Spin animation (used for loading/refresh states). */
  spin?: boolean;
  size?: number | string;
}

function makeIcon(Icon: LucideIcon, displayName: string) {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>(
    ({ className, style, spin, size, ...rest }, ref) => {
      const inline = (style ?? {}) as React.CSSProperties;
      const resolvedSize =
        size ??
        (typeof inline.fontSize === 'number' ? inline.fontSize : undefined) ??
        '1em';
      return (
        <Icon
          ref={ref}
          size={resolvedSize}
          color={inline.color as string | undefined}
          className={cn('inline-block shrink-0', spin && 'animate-spin', className)}
          style={style}
          {...rest}
        />
      );
    },
  );
  Wrapped.displayName = displayName;
  return Wrapped;
}

export const SoundOutlined = makeIcon(Volume2, 'SoundOutlined');
export const AudioOutlined = makeIcon(Mic, 'AudioOutlined');
export const AudioMutedOutlined = makeIcon(MicOff, 'AudioMutedOutlined');
export const VolumeMutedIcon = makeIcon(VolumeX, 'VolumeMutedIcon');
export const CloseOutlined = makeIcon(X, 'CloseOutlined');
export const ReloadOutlined = makeIcon(RotateCw, 'ReloadOutlined');
export const MenuOutlined = makeIcon(Menu, 'MenuOutlined');
export const SettingOutlined = makeIcon(Settings, 'SettingOutlined');
export const CheckOutlined = makeIcon(Check, 'CheckOutlined');
export const TrophyOutlined = makeIcon(Trophy, 'TrophyOutlined');
export const FireOutlined = makeIcon(Flame, 'FireOutlined');
export const InfoCircleOutlined = makeIcon(Info, 'InfoCircleOutlined');
export const PlayCircleOutlined = makeIcon(PlayCircle, 'PlayCircleOutlined');
export const MusicIcon = makeIcon(Music, 'MusicIcon');
export const ChevronDownIcon = makeIcon(ChevronDown, 'ChevronDownIcon');
export const ChevronRightIcon = makeIcon(ChevronRight, 'ChevronRightIcon');
export const ChevronLeftIcon = makeIcon(ChevronLeft, 'ChevronLeftIcon');
export const SpinnerIcon = makeIcon(Loader2, 'SpinnerIcon');

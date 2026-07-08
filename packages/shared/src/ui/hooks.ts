import { useEffect, useState } from 'react';

export interface Breakpoints {
  xs: boolean;
  sm: boolean;
  md: boolean;
  lg: boolean;
  xl: boolean;
  xxl: boolean;
}

const QUERIES: Array<[keyof Breakpoints, number]> = [
  ['xs', 0],
  ['sm', 576],
  ['md', 768],
  ['lg', 992],
  ['xl', 1200],
  ['xxl', 1600],
];

function compute(width: number): Breakpoints {
  const result = {} as Breakpoints;
  for (const [key, min] of QUERIES) result[key] = width >= min;
  result.xs = true;
  return result;
}

/**
 * Responsive breakpoint hook (antd Grid.useBreakpoint-compatible subset).
 * On phones every breakpoint above `sm`/`md` resolves to false, so the
 * mobile-first layout branches are used by default.
 */
export function useBreakpoint(): Breakpoints {
  const [bp, setBp] = useState<Breakpoints>(() =>
    compute(typeof window !== 'undefined' ? window.innerWidth : 375),
  );

  useEffect(() => {
    const onResize = () => setBp(compute(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return bp;
}

/** Design tokens (antd theme.useToken-compatible subset) sourced from the theme palette. */
export const designToken = {
  colorPrimary: '#3b82f6',
  colorPrimaryBg: '#132540',
  colorSuccess: '#22c55e',
  colorWarning: '#f59e0b',
  colorError: '#ef4444',
  colorInfo: '#3b82f6',
  colorText: 'rgba(236, 240, 248, 0.94)',
  colorTextSecondary: 'rgba(236, 240, 248, 0.64)',
  colorTextTertiary: 'rgba(236, 240, 248, 0.46)',
  colorTextQuaternary: 'rgba(236, 240, 248, 0.30)',
  colorBorder: '#2a3450',
  colorBorderSecondary: '#1d2638',
  colorBgContainer: '#131a28',
  colorBgLayout: '#080b12',
  borderRadius: 16,
};

export type DesignToken = typeof designToken;

export const theme = {
  useToken: () => ({ token: designToken }),
  defaultAlgorithm: 'default' as const,
};

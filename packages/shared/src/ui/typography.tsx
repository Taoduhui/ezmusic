import * as React from 'react';
import { cn } from './cn';

type TextType = 'secondary' | 'success' | 'warning' | 'danger';

const typeClass: Record<TextType, string> = {
  secondary: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
  type?: TextType;
  strong?: boolean;
  italic?: boolean;
}

export const Text = React.forwardRef<HTMLSpanElement, TextProps>(
  ({ className, type, strong, italic, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        type && typeClass[type],
        strong && 'font-semibold',
        italic && 'italic',
        className,
      )}
      {...props}
    />
  ),
);
Text.displayName = 'Text';

export interface TitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3 | 4 | 5;
}

const titleSize: Record<NonNullable<TitleProps['level']>, string> = {
  1: 'text-3xl font-bold',
  2: 'text-2xl font-bold',
  3: 'text-xl font-semibold',
  4: 'text-lg font-semibold',
  5: 'text-base font-semibold',
};

export const Title = React.forwardRef<HTMLHeadingElement, TitleProps>(
  ({ className, level = 3, children, ...props }, ref) => {
    const Tag = `h${level}` as 'h1';
    return (
      <Tag
        ref={ref as React.Ref<HTMLHeadingElement>}
        className={cn('text-foreground tracking-tight', titleSize[level], className)}
        {...props}
      >
        {children}
      </Tag>
    );
  },
);
Title.displayName = 'Title';

export interface ParagraphProps extends React.HTMLAttributes<HTMLParagraphElement> {
  type?: TextType;
}

export const Paragraph = React.forwardRef<HTMLParagraphElement, ParagraphProps>(
  ({ className, type, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('leading-relaxed text-foreground', type && typeClass[type], className)}
      {...props}
    />
  ),
);
Paragraph.displayName = 'Paragraph';

export const Typography = { Text, Title, Paragraph };

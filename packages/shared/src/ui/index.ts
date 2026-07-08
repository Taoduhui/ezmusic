/**
 * @ezmusic/shared UI kit — custom components built on Radix primitives
 * following the shadcn/ui pattern, styled with Tailwind design tokens.
 */
export { cn } from './cn';

export { Button, buttonVariants } from './button';
export type { ButtonProps } from './button';

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card';
export type { CardProps } from './card';

export { Text, Title, Paragraph, Typography } from './typography';
export type { TextProps, TitleProps } from './typography';

export { Tag } from './tag';
export type { TagProps } from './tag';

export { Switch } from './switch';
export type { SwitchProps } from './switch';

export { Slider } from './slider';
export type { SliderProps } from './slider';

export { Progress } from './progress';
export type { ProgressProps } from './progress';

export { Select } from './select';
export type { SelectProps, SelectOption } from './select';

export { Sheet, Drawer } from './sheet';
export type { SheetProps } from './sheet';

export { Alert } from './alert';
export type { AlertProps } from './alert';

export { Tooltip, TooltipProvider, TooltipContent } from './tooltip';
export type { TooltipProps } from './tooltip';

export { Toaster, message, notification } from './toast';
export type { NotificationConfig } from './toast';

export { Space, Row, Col, Divider } from './layout';
export type { SpaceProps, RowProps, ColProps, DividerProps } from './layout';

export { Table } from './table';
export type { TableProps, TableColumn } from './table';

export { Descriptions, Collapse, Popconfirm } from './misc';
export type {
  DescriptionsProps,
  DescriptionItem,
  CollapseProps,
  CollapseItem,
  PopconfirmProps,
} from './misc';

export { useBreakpoint, theme, designToken } from './hooks';
export type { Breakpoints, DesignToken } from './hooks';

export * from './icons';

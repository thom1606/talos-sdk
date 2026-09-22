import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createElement,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { type TextParameters, t } from './localization.js';

export type { TalosConfig, TalosContext, TalosFile } from './index.js';
export type { TextParameters } from './localization.js';
export { t } from './localization.js';
export { useTalos } from './talos-context.js';
export type { ReadFileOptions } from './window.js';
export { talosWindow } from './window.js';

export type TextSize =
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption'
  | 'caption2';
export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  size?: TextSize;
  as?: 'span' | 'p' | 'div' | 'label' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  tone?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  /** Optional shortcut for children={t(key, parameters)}. */
  textKey?: string;
  parameters?: TextParameters;
  children?: ReactNode;
}

/** Semantic macOS typography. Strings are plain text; localization is explicit, never guessed. */
export function Text({
  size = 'body',
  as = 'span',
  tone = 'primary',
  weight,
  textKey,
  parameters,
  children,
  style,
  ...props
}: TextProps) {
  if (textKey !== undefined && children !== undefined)
    throw new Error('Text accepts textKey or children, not both');
  const weights = { regular: 400, medium: 500, semibold: 600, bold: 700 };
  const typography: CSSProperties = {
    fontSize: `var(--talos-font-${size}-size)`,
    lineHeight: `var(--talos-font-${size}-line-height)`,
    fontWeight: weight ? weights[weight] : `var(--talos-font-${size}-weight)`,
    color: `var(--talos-label-${tone})`,
    ...style,
  };
  return createElement(
    as,
    { ...props, 'data-talos-text': size, style: typography },
    textKey === undefined ? children : t(textKey, parameters),
  );
}

// Keep Text usable in inline action JSX without executing it in the Node process.
Object.defineProperty(Text, Symbol.for('talos.window.component'), { value: 'talos:Text' });

export type ButtonVariant = 'default' | 'primary' | 'plain';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/** A semantic HTML button with Talos's shared macOS styling and native accent color. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', type = 'button', children, ...props },
  ref,
) {
  // biome-ignore lint/a11y/useButtonType: ButtonHTMLAttributes restricts type; the default above is button.
  return createElement('button', { ...props, ref, type, 'data-variant': variant }, children);
});
Button.displayName = 'Button';
Object.defineProperty(Button, Symbol.for('talos.window.component'), { value: 'talos:Button' });

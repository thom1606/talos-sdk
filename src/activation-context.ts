import type { TalosContext } from './index.js';

/** The host owns async-local storage; bundled SDK copies read the same invocation scope. */
export function activationContext(): TalosContext {
  const read = (globalThis as Record<symbol, (() => TalosContext | undefined) | undefined>)[
    Symbol.for('talos.activationContext')
  ];
  const context = read?.();
  if (!context) throw new Error('openWindow must be called from an activate invocation in Talos.');
  return context;
}

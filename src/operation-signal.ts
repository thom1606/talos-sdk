import type { TalosActivationContext } from './index.js';

/** Works outside Talos too; inside an action/window request both cancellation sources apply. */
export function operationSignal(signal?: AbortSignal): AbortSignal | undefined {
  const read = (
    globalThis as Record<symbol, (() => TalosActivationContext | undefined) | undefined>
  )[Symbol.for('talos.activationContext')];
  const active = read?.()?.signal;
  return active && signal && active !== signal
    ? AbortSignal.any([active, signal])
    : (active ?? signal);
}

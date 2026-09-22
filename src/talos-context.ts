import { createContext, useContext } from 'react';
import type { TalosConfig, TalosConfigValue, TalosContext } from './index.js';

/** Internal provider; the generated renderer supplies it for every window. */
export const TalosReactContext = createContext<TalosContext | null>(null);

/** The complete activation context captured when this window was opened. */
export function useTalos<
  Config extends Record<keyof Config, TalosConfigValue> = TalosConfig,
>(): TalosContext<Config> {
  const context = useContext(TalosReactContext);
  if (!context) throw new Error('useTalos must be used inside a React window opened by Talos.');
  return context as TalosContext<Config>;
}

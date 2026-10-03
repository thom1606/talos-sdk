import type { Activate, TalosActivationContext, TalosConfig, TalosConfigValue } from './index.js';

/** Dispatch only explicitly registered action names, preserving each name's literal type. */
export function defineActions<const Name extends string>(
  handlers: {
    [Action in Name]: (
      context: TalosActivationContext & { action: Action },
    ) => void | Promise<void>;
  },
): Activate {
  return async (context) => {
    context.signal.throwIfAborted();
    if (!Object.hasOwn(handlers, context.action)) {
      throw new Error(`Unknown Talos action: ${context.action}`);
    }
    const action = context.action as Name;
    await handlers[action]({ ...context, action, signal: context.signal });
  };
}

/** Validate configuration at the process boundary before passing typed values to a handler. */
export function defineAction<Config extends Record<keyof Config, TalosConfigValue>>(
  parseConfig: (values: TalosConfig) => Config,
  handler: Activate<Config>,
): Activate {
  return (context) => {
    context.signal.throwIfAborted();
    return handler({ ...context, config: parseConfig(context.config), signal: context.signal });
  };
}

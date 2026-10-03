import { defineAction, defineActions, type TalosContext } from '../../dist/index.js';
import { runProcess } from '../../dist/node.js';

defineActions({
  resize: (context) => {
    const action: 'resize' = context.action;
    const signal: AbortSignal = context.signal;
    // @ts-expect-error An unrelated command is not this handler's action.
    const wrong: 'archive' = context.action;
    void [action, signal, wrong];
  },
  archive: () => {},
});
defineAction(
  (values) => {
    if (typeof values.width !== 'number') throw new Error('Invalid width');
    return { width: values.width };
  },
  (context) => {
    const width: number = context.config.width;
    // @ts-expect-error Width has been parsed as a number, not a string.
    const wrong: string = context.config.width;
    // @ts-expect-error An unregistered configuration key is not available.
    void context.config.height;
    void [width, wrong];
  },
);
// Browser context stays serializable and does not pretend to carry a Node AbortSignal.
const windowContext: TalosContext = { action: 'archive', config: {}, files: [] };
void windowContext;
// @ts-expect-error Commands accept argument arrays, never a shell command string.
void runProcess('/usr/bin/echo', 'hello');

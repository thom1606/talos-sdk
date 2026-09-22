import { createElement, type ElementType, Fragment, type ReactNode } from 'react';
import type { TalosContext } from './index.js';
import { TalosReactContext } from './talos-context.js';
import type { WindowValue } from './window-tree.js';

/** Used by the generated browser entrypoint; component implementations never enter Node. */
export function restoreWindowTree(
  value: WindowValue,
  components: Record<string, ElementType>,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  switch (value.kind) {
    case 'undefined':
      return undefined;
    case 'array':
      return value.items.map((item) => restoreWindowTree(item, components));
    case 'object':
      return Object.fromEntries(
        value.entries.map(([key, item]) => [key, restoreWindowTree(item, components)]),
      );
    case 'element': {
      const type = value.component
        ? value.type === 'talos:fragment'
          ? Fragment
          : components[value.type]
        : value.type;
      if (!type) throw new Error(`Unknown window component: ${value.type}`);
      const props = restoreWindowTree(value.props, components) as Record<string, unknown>;
      return createElement(type, { ...props, key: value.key });
    }
  }
}

export function windowRoot(components: Record<string, ElementType>): ReactNode {
  const bridge = (
    globalThis as typeof globalThis & {
      __talosWindow: { data: { tree: WindowValue }; context?: TalosContext };
    }
  ).__talosWindow;
  if (!bridge.context)
    throw new Error(
      'This window needs an activation context. Update Talos and rebuild the extension.',
    );
  return createElement(
    TalosReactContext.Provider,
    { value: bridge.context },
    restoreWindowTree(bridge.data.tree, components) as ReactNode,
  );
}

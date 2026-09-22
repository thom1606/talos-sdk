import type { ReactElement, ReactNode } from 'react';

const Fragment = Symbol.for('react.fragment');
function isElement(value: object): value is ReactElement<Record<string, unknown>> {
  const tag = (value as { $$typeof?: symbol }).$$typeof;
  return tag === Symbol.for('react.transitional.element') || tag === Symbol.for('react.element');
}

/** Internal wire format. Every container is tagged so user props cannot collide with elements. */
export type WindowValue = null | string | number | boolean | WindowContainer;
export type WindowContainer =
  | { kind: 'undefined' }
  | { kind: 'array'; items: WindowValue[] }
  | { kind: 'object'; entries: [string, WindowValue][] }
  | { kind: 'element'; type: string; component: boolean; key: string | null; props: WindowValue };

export const componentReference = Symbol.for('talos.window.component');
export const reactWindowPage = 'talos-react';

/** Transfer data and element descriptions, never executable closures from the action process. */
export function serializeWindowTree(children: ReactNode): WindowValue {
  const ancestors = new Set<object>();
  function visit(value: unknown, path: string): WindowValue {
    if (value === undefined) return { kind: 'undefined' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object') {
      throw new Error(
        `${path} cannot cross into a window. Keep callbacks and hooks inside an imported .tsx component.`,
      );
    }
    if (ancestors.has(value)) throw new Error(`${path} contains a circular reference`);
    ancestors.add(value);
    try {
      if (isElement(value)) {
        const type: unknown = value.type;
        const reference =
          typeof type === 'function' || (typeof type === 'object' && type !== null)
            ? (type as unknown as Record<symbol, unknown>)[componentReference]
            : undefined;
        if (typeof type !== 'string' && type !== Fragment && typeof reference !== 'string') {
          throw new Error(
            `${path}: import the window component from a separate .tsx file; local action components cannot run in a browser.`,
          );
        }
        if (value.props.ref != null)
          throw new Error(`${path}: refs must be created inside the window component`);
        return {
          kind: 'element',
          type:
            type === Fragment
              ? 'talos:fragment'
              : typeof reference === 'string'
                ? reference
                : (type as string),
          component: typeof type !== 'string',
          key: value.key,
          props: visit(value.props, `${path}.props`),
        };
      }
      if (Array.isArray(value))
        return {
          kind: 'array',
          items: value.map((item, index) => visit(item, `${path}[${index}]`)),
        };
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        throw new Error(`${path} must contain plain data, not class instances`);
      }
      if (Object.getOwnPropertySymbols(value).length)
        throw new Error(`${path} contains symbol properties`);
      return {
        kind: 'object',
        entries: Object.entries(value).map(([key, item]) => [key, visit(item, `${path}.${key}`)]),
      };
    } finally {
      ancestors.delete(value);
    }
  }
  return visit(children, 'children');
}

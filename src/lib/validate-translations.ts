import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

/** Validate statically named action and window translations without confusing comments or unrelated t() functions. */
export async function validateTranslations(
  files: string[],
  english: Record<string, unknown>,
): Promise<void> {
  function hasKey(key: string): boolean {
    if (Object.hasOwn(english, key) && typeof english[key] === 'string') return true;
    let value: unknown = english;
    for (const part of key.split('.')) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return false;
      value = (value as Record<string, unknown>)[part];
    }
    return typeof value === 'string';
  }
  for (const file of files) {
    const source = parse(await readFile(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const functions = new Set<string>();
    const components = new Set<string>();
    for (const statement of source.program.body) {
      if (
        !t.isImportDeclaration(statement) ||
        !t.isStringLiteral(statement.source) ||
        ![
          '@thom1606/talos-sdk',
          '@thom1606/talos-sdk/react',
          '@thom1606/talos-sdk/window',
        ].includes(statement.source.value)
      )
        continue;
      for (const element of statement.specifiers) {
        if (!t.isImportSpecifier(element)) continue;
        const imported = t.isIdentifier(element.imported)
          ? element.imported.name
          : element.imported.value;
        if (imported === 't') functions.add(element.local.name);
        if (imported === 'Text') components.add(element.local.name);
      }
    }
    const check = (key: string) => {
      if (!hasKey(key)) throw new Error(`Missing translation for key: ${key} (${file})`);
    };
    const visit = (node: t.Node) => {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        functions.has(node.callee.name)
      ) {
        const key = node.arguments[0];
        if (t.isStringLiteral(key)) check(key.value);
        else if (t.isTemplateLiteral(key) && key.expressions.length === 0)
          check(key.quasis[0]?.value.cooked ?? '');
      }
      if (
        t.isJSXOpeningElement(node) &&
        t.isJSXIdentifier(node.name) &&
        components.has(node.name.name)
      ) {
        for (const attribute of node.attributes) {
          if (
            !t.isJSXAttribute(attribute) ||
            !t.isJSXIdentifier(attribute.name, { name: 'textKey' })
          )
            continue;
          const value = attribute.value;
          if (t.isStringLiteral(value)) check(value.value);
          else if (t.isJSXExpressionContainer(value) && t.isStringLiteral(value.expression))
            check(value.expression.value);
        }
      }
      for (const key of t.VISITOR_KEYS[node.type] ?? []) {
        const child = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) if (t.isNode(item)) visit(item);
        } else if (t.isNode(child)) visit(child);
      }
    };
    visit(source.program);
  }
}

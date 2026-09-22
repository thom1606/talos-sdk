export type TextParameters = Record<string, string | number>;
export type TranslationCatalog = Record<string, unknown>;

interface LocalizationEnvironment {
  __talosPreferredLanguages?: string[];
  __talosLocales?: Record<string, TranslationCatalog>;
  __talosWindow?: { preferredLanguages?: string[] };
  navigator?: { languages?: readonly string[] };
}

function lookup(catalog: TranslationCatalog | undefined, key: string): string | undefined {
  if (!catalog) return undefined;
  if (Object.hasOwn(catalog, key) && typeof catalog[key] === 'string') return catalog[key];
  let value: unknown = catalog;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as TranslationCatalog)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

/** Shared action/window translations; catalogs and language preferences arrive before extension code. */
export function t(key: string, parameters: TextParameters = {}): string {
  const environment = globalThis as LocalizationEnvironment;
  const catalogs = environment.__talosLocales ?? {};
  const preferred = environment.__talosWindow?.preferredLanguages ??
    environment.__talosPreferredLanguages ??
    environment.navigator?.languages ?? ['en'];
  const normalize = (locale: string) => locale.toLowerCase().replaceAll('_', '-');
  const available = Object.keys(catalogs);
  let translated: string | undefined;
  for (const preference of [...preferred, 'en']) {
    const locale = normalize(preference);
    const exact = available.find((candidate) => normalize(candidate) === locale);
    const language = locale.split('-')[0];
    const base = available.find((candidate) => normalize(candidate) === language);
    translated =
      lookup(exact ? catalogs[exact] : undefined, key) ??
      lookup(base ? catalogs[base] : undefined, key);
    if (translated !== undefined) break;
  }
  if (translated === undefined) throw new Error(`Missing translation for key: ${key}`);
  return translated.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_placeholder, name: string) => {
    if (!Object.hasOwn(parameters, name))
      throw new Error(`Missing translation parameter ${name} for ${key}`);
    return String(parameters[name]);
  });
}

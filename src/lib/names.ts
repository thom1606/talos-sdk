const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;

export function toBundleId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'talos-extension'
  );
}

export function isIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

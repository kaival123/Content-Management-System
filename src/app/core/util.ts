export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/**
 * First URL segments the app uses itself. Websites live at /<website>, so these
 * can't be website URLs ("p" was the old /p/<website> prefix and still redirects).
 */
export const RESERVED_SLUGS = ['admin', 'api', 'site', 'p', 'assets', 'media', 'login'];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.toLowerCase());
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

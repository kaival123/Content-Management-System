// Country dial codes and national mobile-number lengths, for the phone input's
// country dropdown and its per-country length validation.
//
// `min`/`max` are the number of digits in the NATIONAL part (after the dial code).
// Numbers are stored/compared as E.164: "+" + dial code + national digits.

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string; // without the leading "+"
  min: number;
  max: number;
}

export const COUNTRIES: Country[] = [
  { code: 'AU', name: 'Australia', dial: '61', min: 9, max: 9 },
  { code: 'AT', name: 'Austria', dial: '43', min: 10, max: 11 },
  { code: 'BD', name: 'Bangladesh', dial: '880', min: 10, max: 10 },
  { code: 'BE', name: 'Belgium', dial: '32', min: 9, max: 9 },
  { code: 'BR', name: 'Brazil', dial: '55', min: 10, max: 11 },
  { code: 'CA', name: 'Canada', dial: '1', min: 10, max: 10 },
  { code: 'CN', name: 'China', dial: '86', min: 11, max: 11 },
  { code: 'DK', name: 'Denmark', dial: '45', min: 8, max: 8 },
  { code: 'EG', name: 'Egypt', dial: '20', min: 10, max: 10 },
  { code: 'FI', name: 'Finland', dial: '358', min: 9, max: 10 },
  { code: 'FR', name: 'France', dial: '33', min: 9, max: 9 },
  { code: 'DE', name: 'Germany', dial: '49', min: 10, max: 11 },
  { code: 'GR', name: 'Greece', dial: '30', min: 10, max: 10 },
  { code: 'HK', name: 'Hong Kong', dial: '852', min: 8, max: 8 },
  { code: 'IN', name: 'India', dial: '91', min: 10, max: 10 },
  { code: 'ID', name: 'Indonesia', dial: '62', min: 9, max: 12 },
  { code: 'IE', name: 'Ireland', dial: '353', min: 9, max: 9 },
  { code: 'IL', name: 'Israel', dial: '972', min: 9, max: 9 },
  { code: 'IT', name: 'Italy', dial: '39', min: 9, max: 10 },
  { code: 'JP', name: 'Japan', dial: '81', min: 10, max: 10 },
  { code: 'KE', name: 'Kenya', dial: '254', min: 9, max: 9 },
  { code: 'MY', name: 'Malaysia', dial: '60', min: 9, max: 10 },
  { code: 'MX', name: 'Mexico', dial: '52', min: 10, max: 10 },
  { code: 'NL', name: 'Netherlands', dial: '31', min: 9, max: 9 },
  { code: 'NZ', name: 'New Zealand', dial: '64', min: 8, max: 10 },
  { code: 'NG', name: 'Nigeria', dial: '234', min: 10, max: 10 },
  { code: 'NO', name: 'Norway', dial: '47', min: 8, max: 8 },
  { code: 'PK', name: 'Pakistan', dial: '92', min: 10, max: 10 },
  { code: 'PH', name: 'Philippines', dial: '63', min: 10, max: 10 },
  { code: 'PL', name: 'Poland', dial: '48', min: 9, max: 9 },
  { code: 'PT', name: 'Portugal', dial: '351', min: 9, max: 9 },
  { code: 'QA', name: 'Qatar', dial: '974', min: 8, max: 8 },
  { code: 'RU', name: 'Russia', dial: '7', min: 10, max: 10 },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', min: 9, max: 9 },
  { code: 'SG', name: 'Singapore', dial: '65', min: 8, max: 8 },
  { code: 'ZA', name: 'South Africa', dial: '27', min: 9, max: 9 },
  { code: 'KR', name: 'South Korea', dial: '82', min: 9, max: 10 },
  { code: 'ES', name: 'Spain', dial: '34', min: 9, max: 9 },
  { code: 'LK', name: 'Sri Lanka', dial: '94', min: 9, max: 9 },
  { code: 'SE', name: 'Sweden', dial: '46', min: 7, max: 9 },
  { code: 'CH', name: 'Switzerland', dial: '41', min: 9, max: 9 },
  { code: 'TW', name: 'Taiwan', dial: '886', min: 9, max: 9 },
  { code: 'TH', name: 'Thailand', dial: '66', min: 9, max: 9 },
  { code: 'TR', name: 'Türkiye', dial: '90', min: 10, max: 10 },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', min: 9, max: 9 },
  { code: 'GB', name: 'United Kingdom', dial: '44', min: 10, max: 10 },
  { code: 'US', name: 'United States', dial: '1', min: 10, max: 10 },
  { code: 'VN', name: 'Vietnam', dial: '84', min: 9, max: 10 },
];

/** The default country shown first (can be changed). */
export const DEFAULT_COUNTRY = 'IN';

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** 🇮🇳-style flag emoji from an ISO country code. */
export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

/** Just the digits of a string. */
export function digitsOf(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** True when the national digits match the country's allowed length. */
export function isValidNational(country: Country, national: string): boolean {
  const n = digitsOf(national).length;
  return n >= country.min && n <= country.max;
}

/** Builds an E.164 string from a country and national digits (empty national → ""). */
export function toE164(country: Country, national: string): string {
  const d = digitsOf(national);
  return d ? `+${country.dial}${d}` : '';
}

/**
 * Splits an E.164 value back into a country + national part, matching the longest
 * dial code. Falls back to the default country when it can't be matched.
 */
export function parseE164(value: string, fallback = DEFAULT_COUNTRY): { country: Country; national: string } {
  const def = countryByCode(fallback) ?? COUNTRIES[0];
  const digits = digitsOf(value);
  if (!value || !value.trim().startsWith('+') || !digits) return { country: def, national: digits };
  // Longest dial code first so "+1" doesn't shadow "+971", etc.
  const byDialLen = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of byDialLen) {
    if (digits.startsWith(c.dial)) return { country: c, national: digits.slice(c.dial.length) };
  }
  return { country: def, national: digits };
}

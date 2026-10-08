import { countryByCode, isValidNational, parseE164, toE164 } from './phone';

const IN = countryByCode('IN')!;
const US = countryByCode('US')!;
const AE = countryByCode('AE')!;

describe('phone helpers', () => {
  it('validates national length per country', () => {
    expect(isValidNational(IN, '9876543210')).toBe(true); // 10
    expect(isValidNational(IN, '98765432')).toBe(false); // 8
    expect(isValidNational(US, '2025550123')).toBe(true); // 10
    expect(isValidNational(AE, '501234567')).toBe(true); // 9
    expect(isValidNational(AE, '5012345678')).toBe(false); // 10
  });

  it('builds E.164 from country + national (ignoring formatting)', () => {
    expect(toE164(IN, '98765 43210')).toBe('+919876543210');
    expect(toE164(US, '(202) 555-0123')).toBe('+12025550123');
    expect(toE164(IN, '')).toBe('');
  });

  it('parses E.164 back into country + national, matching the longest dial code', () => {
    expect(parseE164('+919876543210')).toEqual({ country: IN, national: '9876543210' });
    expect(parseE164('+971501234567').country.code).toBe('AE'); // not shadowed by a shorter dial code
    // +1 is shared by US and Canada, so only the national part is unambiguous here.
    expect(parseE164('+12025550123').national).toBe('2025550123');
  });

  it('falls back to the default country for empty or non-E.164 input', () => {
    expect(parseE164('').national).toBe('');
    expect(parseE164('', 'US').country.code).toBe('US');
  });
});

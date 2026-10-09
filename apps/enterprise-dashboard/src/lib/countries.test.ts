import { describe, expect, it } from 'vitest';
import { AFRICA_OPTIONS, COUNTRY_MAP, filterCountries } from './countries.js';

const names = (codes: string[]) => codes.map((c) => COUNTRY_MAP[c]);

describe('filterCountries', () => {
  it('returns every country with the African ones first when nothing is typed', () => {
    const all = filterCountries('');
    expect(all.slice(0, AFRICA_OPTIONS.length)).toEqual(AFRICA_OPTIONS);
    expect(all).toHaveLength(Object.keys(COUNTRY_MAP).length);
    expect(AFRICA_OPTIONS).toHaveLength(54);
  });

  it('finds a country by the start of its name, ignoring case', () => {
    expect(names(filterCountries('nig'))).toEqual(['Niger', 'Nigeria']);
    expect(names(filterCountries('KEN'))).toEqual(['Kenya']);
  });

  it('matches any word in the name, so "congo" finds both Congos and "south" finds South Africa', () => {
    expect(names(filterCountries('congo'))).toEqual(['Democratic Republic of Congo', 'Republic of Congo']);
    expect(names(filterCountries('south'))).toEqual(expect.arrayContaining(['South Africa', 'South Sudan', 'South Korea']));
  });

  it('ignores accents and punctuation', () => {
    expect(names(filterCountries('cote'))).toEqual(["Côte d'Ivoire"]);
    expect(names(filterCountries('sao'))).toEqual(['São Tomé and Príncipe']);
  });

  it('matches a two-letter code exactly', () => {
    expect(filterCountries('ng')).toContain('NG');
    expect(filterCountries('za')[0]).toBe('ZA');
  });

  it('lists African matches before the rest', () => {
    const matches = names(filterCountries('south'));
    expect(matches.indexOf('South Korea')).toBeGreaterThan(matches.indexOf('South Africa'));
    expect(matches.indexOf('South Korea')).toBeGreaterThan(matches.indexOf('South Sudan'));
  });

  it('returns nothing for text that matches no country', () => {
    expect(filterCountries('zzzz')).toEqual([]);
  });
});

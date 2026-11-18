import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '#lib/paraglide/runtime.js';
import { ruleSentence, sanitizeRules } from './catalog.ts';

const ctx = { currency: 'PLN', tz: 'Europe/Warsaw' };
const sentence = (n: string) => ruleSentence({ type: 'gift_count', value: { n } }, ctx);

describe('gift_count rule', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it('says gifts go to the one drawn person (en)', () => {
		overwriteGetLocale(() => 'en');
		expect(sentence('1')).toBe('Everyone prepares 1 gift for the one person they drew.');
		expect(sentence('3')).toBe('Everyone prepares 3 gifts for the one person they drew.');
	});

	it('uses Lithuanian plural forms', () => {
		overwriteGetLocale(() => 'lt');
		expect(sentence('1')).toBe('Kiekvienas paruošia 1 dovaną tam vienam ištrauktam žmogui.');
		expect(sentence('3')).toBe('Kiekvienas paruošia 3 dovanas tam vienam ištrauktam žmogui.');
		expect(sentence('5')).toBe('Kiekvienas paruošia 5 dovanas tam vienam ištrauktam žmogui.');
		expect(sentence('10')).toBe('Kiekvienas paruošia 10 dovanų tam vienam ištrauktam žmogui.');
		expect(sentence('21')).toBe('Kiekvienas paruošia 21 dovaną tam vienam ištrauktam žmogui.');
		expect(sentence('22')).toBe('Kiekvienas paruošia 22 dovanas tam vienam ištrauktam žmogui.');
	});

	it('uses Polish plural forms', () => {
		overwriteGetLocale(() => 'pl');
		expect(sentence('1')).toBe('Każdy przygotowuje 1 prezent dla jednej wylosowanej osoby.');
		expect(sentence('3')).toBe('Każdy przygotowuje 3 prezenty dla jednej wylosowanej osoby.');
		expect(sentence('5')).toBe('Każdy przygotowuje 5 prezentów dla jednej wylosowanej osoby.');
		expect(sentence('22')).toBe('Każdy przygotowuje 22 prezenty dla jednej wylosowanej osoby.');
	});
});

describe('sanitizeRules', () => {
	it('drops unknown types and invalid values', () => {
		expect(
			sanitizeRules([
				{ type: 'nope', value: {} },
				{ type: 'gift_count', value: { n: '0' } },
				{ type: 'gift_count', value: { n: '2' } },
				{ type: 'max_cost', value: { amount: '99,5' } },
				{ type: 'secrecy', value: { option: 'hack' } }
			])
		).toEqual([
			{ type: 'gift_count', value: { n: '2' } },
			{ type: 'max_cost', value: { amount: '99.5' } },
			{ type: 'secrecy', value: { option: 'until_party' } }
		]);
	});
});

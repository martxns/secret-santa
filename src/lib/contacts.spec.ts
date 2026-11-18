import { describe, expect, it } from 'vitest';
import {
	buildSmsHref,
	parseContactText,
	parseVcf,
	renderSmsMessage,
	smsPhoneDigits
} from './contacts.ts';

describe('parseVcf', () => {
	it('parses iOS vCard exports with grouped TEL fields and multiple contacts', () => {
		const vcf = [
			'BEGIN:VCARD',
			'VERSION:3.0',
			'N:Kowalska;Anna;;;',
			'FN:Anna Kowalska',
			'item1.TEL;type=HOME;type=VOICE:+48 22 111 22 33',
			'item2.TEL;type=CELL;type=VOICE;type=pref:+48 600 123 456',
			'END:VCARD',
			'BEGIN:VCARD',
			'VERSION:3.0',
			'FN:Uncle Bob',
			'NICKNAME:Wujek',
			'TEL;TYPE=IPHONE:(555) 987-6543',
			'END:VCARD'
		].join('\r\n');

		expect(parseVcf(vcf)).toEqual([
			{ firstName: 'Anna', lastName: 'Kowalska', nickname: '', phone: '+48 600 123 456' },
			{ firstName: 'Uncle', lastName: 'Bob', nickname: 'Wujek', phone: '(555) 987-6543' }
		]);
	});

	it('decodes UTF-8 quoted-printable vCard names', () => {
		const vcf = [
			'BEGIN:VCARD',
			'VERSION:2.1',
			'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C5=BBaneta;=C5=81ukasz;;;',
			'TEL;CELL:+48500100200',
			'END:VCARD'
		].join('\n');

		expect(parseVcf(vcf)).toEqual([
			{ firstName: 'Łukasz', lastName: 'Żaneta', nickname: '', phone: '+48500100200' }
		]);
	});
});

describe('parseContactText', () => {
	it('parses delimited and plain name-phone lines', () => {
		const text = `
Anna Kowalska, +48 600 123 456
Bob Tester; 555-123-4567
Celina +1 415 555 0199
`;
		expect(parseContactText(text)).toEqual([
			{ firstName: 'Anna', lastName: 'Kowalska', nickname: '', phone: '+48 600 123 456' },
			{ firstName: 'Bob', lastName: 'Tester', nickname: '', phone: '555-123-4567' },
			{ firstName: 'Celina', lastName: '', nickname: '', phone: '+1 415 555 0199' }
		]);
	});
});

describe('SMS helpers', () => {
	it('strips formatting from phone numbers and builds iOS/Android compatible sms href', () => {
		expect(smsPhoneDigits('+48 600-123-456')).toBe('+48600123456');
		const msg = renderSmsMessage(
			'Hi {name}, open {party}: {link}',
			{ name: 'Anna', party: 'Family Christmas', link: 'https://example.com/p/abc' },
			'Default {link}'
		);
		expect(msg).toBe('Hi Anna, open Family Christmas: https://example.com/p/abc');
		expect(buildSmsHref('+48 600 123 456', msg)).toBe(
			`sms:+48600123456?&body=${encodeURIComponent(msg)}`
		);
	});

	it('appends the magic link if omitted from a custom template', () => {
		const msg = renderSmsMessage(
			'Merry Christmas {name}!',
			{ name: 'Bob', party: 'Xmas', link: 'https://example.com/p/tok' },
			'Default {link}'
		);
		expect(msg).toBe('Merry Christmas Bob!\nhttps://example.com/p/tok');
	});
});

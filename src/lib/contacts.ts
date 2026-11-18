export type ParsedContact = {
	firstName: string;
	lastName: string;
	nickname: string;
	phone: string;
};

export function normalizePhone(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function smsPhoneDigits(phone: string): string {
	const cleaned = phone.trim().replace(/[^\d+]/g, '');
	if (!cleaned) return '';
	return cleaned.startsWith('+')
		? `+${cleaned.slice(1).replace(/\+/g, '')}`
		: cleaned.replace(/\+/g, '');
}

export function renderSmsMessage(
	template: string,
	vars: { name: string; party: string; link: string },
	defaultTemplate: string
): string {
	const base = template.trim() || defaultTemplate;
	const hasLink = base.includes('{link}');
	let out = base
		.replaceAll('{name}', vars.name)
		.replaceAll('{party}', vars.party)
		.replaceAll('{link}', vars.link);
	if (!hasLink && vars.link) out = `${out}\n${vars.link}`;
	return out;
}

export function buildSmsHref(phone: string, message: string): string {
	const digits = smsPhoneDigits(phone);
	const body = encodeURIComponent(message);
	return digits ? `sms:${digits}?&body=${body}` : `sms:?&body=${body}`;
}

export function buildGroupSmsHref(phones: string[], message: string): string {
	const unique = [...new Set(phones.map(smsPhoneDigits).filter(Boolean))];
	const body = encodeURIComponent(message);
	return unique.length ? `sms:${unique.join(',')}?&body=${body}` : `sms:?&body=${body}`;
}

function decodeQuotedPrintable(input: string): string {
	const cleaned = input.replace(/=\r?\n/g, '');
	const bytes: number[] = [];
	for (let i = 0; i < cleaned.length; i++) {
		if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
			bytes.push(Number.parseInt(cleaned.slice(i + 1, i + 3), 16));
			i += 2;
		} else {
			const encoded = new TextEncoder().encode(cleaned[i]);
			for (const b of encoded) bytes.push(b);
		}
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

function unescapeVCardValue(val: string): string {
	return val
		.replace(/\\n/gi, ' ')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\')
		.trim();
}

function splitFullName(full: string): { firstName: string; lastName: string } {
	const parts = full.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { firstName: '', lastName: '' };
	if (parts.length === 1) return { firstName: parts[0], lastName: '' };
	return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function parseVcf(text: string): ParsedContact[] {
	// Handle soft line breaks for QUOTED-PRINTABLE before unfolding normal vCard folded lines
	const pre = text
		.replace(/=\r?\n/g, '=')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
	const unfolded = pre.replace(/\n[ \t]/g, '');
	const blocks = unfolded.split(/BEGIN:VCARD/i).slice(1);
	const out: ParsedContact[] = [];

	for (const block of blocks) {
		const endIdx = block.search(/END:VCARD/i);
		const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
		const lines = body
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);

		let firstName = '';
		let lastName = '';
		let fullName = '';
		let nickname = '';
		const phones: { value: string; priority: number }[] = [];

		for (const line of lines) {
			const colon = line.indexOf(':');
			if (colon < 0) continue;
			const rawKey = line.slice(0, colon);
			let rawVal = line.slice(colon + 1);

			const [propAndGroup, ...params] = rawKey.split(';');
			const prop = propAndGroup.replace(/^[^.]+\./, '').toUpperCase();
			const paramUpper = params.map((p) => p.toUpperCase());
			if (paramUpper.some((p) => p.includes('QUOTED-PRINTABLE'))) {
				rawVal = decodeQuotedPrintable(rawVal);
			}

			if (prop === 'N') {
				const parts = rawVal.split(';').map(unescapeVCardValue);
				const ln = parts[0] ?? '';
				const fn = parts[1] ?? '';
				if (fn || ln) {
					firstName = fn.slice(0, 60);
					lastName = ln.slice(0, 60);
				}
			} else if (prop === 'FN') {
				fullName = unescapeVCardValue(rawVal);
			} else if (prop === 'NICKNAME') {
				nickname = unescapeVCardValue(rawVal).slice(0, 60);
			} else if (prop === 'TEL') {
				const tel = normalizePhone(unescapeVCardValue(rawVal).replace(/^tel:/i, ''));
				if (!tel) continue;
				const joinedParams = paramUpper.join(';');
				let priority = 0;
				if (/CELL|MOBILE|IPHONE/.test(joinedParams)) priority += 2;
				if (/PREF/.test(joinedParams)) priority += 1;
				phones.push({ value: tel, priority });
			}
		}

		if (!firstName && !lastName && fullName) {
			const split = splitFullName(fullName);
			firstName = split.firstName.slice(0, 60);
			lastName = split.lastName.slice(0, 60);
		}

		if (!firstName && !lastName && !nickname) continue;
		phones.sort((a, b) => b.priority - a.priority);
		const phone = phones[0]?.value ?? '';
		if (!phone) continue;

		out.push({ firstName, lastName, nickname, phone });
	}

	return out;
}

export function parseContactText(text: string): ParsedContact[] {
	if (/BEGIN:VCARD/i.test(text)) return parseVcf(text);

	const out: ParsedContact[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		let namePart = '';
		let phonePart = '';
		const delimMatch = line.match(/^([^,;\t:]+)[,;\t:]+(.+)$/);
		if (delimMatch) {
			namePart = delimMatch[1].trim();
			phonePart = delimMatch[2].trim();
		} else {
			const phoneTail = line.match(/^(.+?)\s+(\+?\d[\d\s\-().]{5,})$/);
			if (phoneTail) {
				namePart = phoneTail[1].trim();
				phonePart = phoneTail[2].trim();
			}
		}

		const phone = normalizePhone(phonePart);
		if (!namePart || !/\d{3,}/.test(phone)) continue;
		const { firstName, lastName } = splitFullName(namePart);
		if (!firstName) continue;
		out.push({
			firstName: firstName.slice(0, 60),
			lastName: lastName.slice(0, 60),
			nickname: '',
			phone
		});
	}
	return out;
}

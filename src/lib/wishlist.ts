export type ProductSource = 'all' | 'hotukdeals' | 'morrisons' | 'johnlewis' | 'itunes';

export type ProductSearchResult = {
	title: string;
	price: string;
	imageUrl: string;
	productUrl: string;
	store: string;
	source: Exclude<ProductSource, 'all'> | 'url' | 'manual';
	blocked?: boolean;
};

export type PublicWishlistItem = {
	id: string;
	title: string;
	price: string;
	imageUrl: string;
	productUrl: string;
	store: string;
	note: string;
};

const KNOWN_STORES: [RegExp, string][] = [
	[/(^|\.)amazon\.co\.uk$/i, 'Amazon UK'],
	[/(^|\.)amazon\.[a-z.]+$/i, 'Amazon'],
	[/(^|\.)tesco\.com$/i, 'Tesco'],
	[/(^|\.)morrisons\.com$/i, 'Morrisons'],
	[/(^|\.)hotukdeals\.com$/i, 'HotUKDeals'],
	[/(^|\.)johnlewis\.com$/i, 'John Lewis'],
	[/(^|\.)argos\.co\.uk$/i, 'Argos'],
	[/(^|\.)sainsburys\.co\.uk$/i, "Sainsbury's"],
	[/(^|\.)asda\.com$/i, 'ASDA'],
	[/(^|\.)boots\.com$/i, 'Boots'],
	[/(^|\.)currys\.co\.uk$/i, 'Currys'],
	[/(^|\.)smythstoys\.com$/i, 'Smyths Toys'],
	[/(^|\.)waterstones\.com$/i, 'Waterstones'],
	[/(^|\.)marksandspencer\.com$/i, 'M&S'],
	[/(^|\.)ikea\.com$/i, 'IKEA'],
	[/(^|\.)lego\.com$/i, 'LEGO'],
	[/(^|\.)ebay\.co\.uk$/i, 'eBay UK'],
	[/(^|\.)etsy\.com$/i, 'Etsy'],
	[/(^|\.)apple\.com$/i, 'Apple']
];

export function inferStoreName(rawUrl: string): string {
	try {
		const host = new URL(rawUrl).hostname.replace(/^www\./i, '');
		for (const [re, name] of KNOWN_STORES) {
			if (re.test(host)) return name;
		}
		return host;
	} catch {
		return '';
	}
}

export function sanitizeHttpUrl(raw: string, maxLen = 1000): string {
	const trimmed = raw.trim().slice(0, maxLen);
	if (!trimmed) return '';
	try {
		const u = new URL(trimmed);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
		return u.toString();
	} catch {
		return '';
	}
}

export function formatCurrencyPrice(amount: unknown, currency = 'GBP'): string {
	const raw = String(amount ?? '').trim();
	if (!raw) return '';
	const num = Number(raw.replace(/[^\d.]/g, ''));
	if (!Number.isFinite(num) || num <= 0) return '';
	const sym =
		currency === 'GBP'
			? '£'
			: currency === 'EUR'
				? '€'
				: currency === 'USD'
					? '$'
					: currency === 'PLN'
						? 'zł'
						: `${currency} `;
	return currency === 'PLN' ? `${num.toFixed(2)} ${sym}` : `${sym}${num.toFixed(2)}`;
}

/** Extracts a readable fallback title from a store URL slug when a site blocks automated fetching. */
export function titleFromProductUrl(rawUrl: string): string {
	try {
		const u = new URL(rawUrl);
		const segments = u.pathname
			.split('/')
			.map((s) => decodeURIComponent(s))
			.filter(Boolean);
		const candidate = segments.find(
			(s) =>
				s.length >= 4 &&
				!/^(dp|gp|product|products|deals|p|s|b|en-gb|uk|groceries)$/i.test(s) &&
				!/^[A-Z0-9]{8,12}$/.test(s) &&
				!/^\d+$/.test(s)
		);
		if (!candidate) return '';
		return candidate
			.replace(/[-_]+/g, ' ')
			.replace(/\.[a-z0-9]{2,5}$/i, '')
			.replace(/\s+\d{6,}$/, '')
			.trim()
			.slice(0, 120);
	} catch {
		return '';
	}
}

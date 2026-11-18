import net from 'node:net';
import {
	formatCurrencyPrice,
	inferStoreName,
	sanitizeHttpUrl,
	titleFromProductUrl,
	type ProductSearchResult,
	type ProductSource
} from '#lib/wishlist.ts';

const BROWSER_HEADERS = {
	'user-agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
	'accept-language': 'en-GB,en;q=0.9'
};

function decodeEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#039;|&#39;|&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&pound;/g, '£')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.trim();
}

export function isAllowedExternalUrl(raw: string): URL | null {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	if (u.username || u.password) return null;
	if (u.port && u.port !== '80' && u.port !== '443') return null;

	const host = u.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host.endsWith('.localhost')
	)
		return null;

	const ipType = net.isIP(host.replace(/^\[|\]$/g, ''));
	if (ipType === 4) {
		const parts = host.split('.').map(Number);
		const [a, b] = parts;
		if (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127)
		) {
			return null;
		}
	} else if (ipType === 6) {
		const bare = host.replace(/^\[|\]$/g, '');
		if (
			bare === '::' ||
			bare === '::1' ||
			bare.startsWith('fc') ||
			bare.startsWith('fd') ||
			bare.startsWith('fe80')
		) {
			return null;
		}
	}

	return u;
}

export function parseHotUkDealsHtml(html: string, limit = 8): ProductSearchResult[] {
	const results: ProductSearchResult[] = [];
	const seen = new Set<string>();
	for (const match of html.matchAll(/data-vue3='([^']+)'/g)) {
		if (!match[1].includes('ThreadMainListItemNormalizer')) continue;
		try {
			const parsed = JSON.parse(decodeEntities(match[1])) as {
				name?: string;
				props?: {
					thread?: {
						threadId?: string | number;
						titleSlug?: string;
						title?: string;
						price?: number;
						discountType?: string;
						isExpired?: boolean;
						isGone?: boolean;
						linkHost?: string;
						merchant?: { merchantName?: string };
						mainImage?: { path?: string; name?: string; uid?: string };
					};
				};
			};
			const t = parsed.props?.thread;
			if (!t?.title || !t.threadId || t.isExpired || t.isGone) continue;
			const slug = t.titleSlug || 'deal';
			const productUrl = `https://www.hotukdeals.com/deals/${slug}-${t.threadId}`;
			if (seen.has(productUrl)) continue;
			seen.add(productUrl);

			const img = t.mainImage;
			const imageUrl =
				img?.path && img?.name && img?.uid
					? `https://images.hotukdeals.com/${img.path}/${img.name}/re/480/qt/90/${img.uid}`
					: '';
			const priceNum = typeof t.price === 'number' ? t.price : 0;
			const price =
				priceNum > 0 ? `£${priceNum.toFixed(2)}` : t.discountType === 'Free' ? 'Free' : '';
			const store = t.merchant?.merchantName || t.linkHost || 'HotUKDeals';
			results.push({
				title: decodeEntities(t.title).slice(0, 180),
				price,
				imageUrl,
				productUrl,
				store: store.slice(0, 80),
				source: 'hotukdeals'
			});
			if (results.length >= limit) break;
		} catch {
			/* ignore malformed card JSON */
		}
	}
	return results;
}

export function parseMorrisonsHtml(html: string, limit = 8): ProductSearchResult[] {
	const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?\s*<\/script>/s);
	if (!stateMatch) return [];

	// Map retailerProductId -> canonical product URL path from HTML hrefs
	const urlBySku = new Map<string, string>();
	for (const linkMatch of html.matchAll(/href="(\/products\/[^"]+\/(\d+))"/g)) {
		if (!urlBySku.has(linkMatch[2])) {
			urlBySku.set(linkMatch[2], `https://groceries.morrisons.com${linkMatch[1]}`);
		}
	}

	try {
		const state = JSON.parse(stateMatch[1]) as {
			data?: {
				products?: {
					productEntities?: Record<string, Record<string, unknown>>;
				} & Record<string, Record<string, unknown>>;
			};
		};
		const entitiesObj = state.data?.products?.productEntities ?? state.data?.products;
		if (!entitiesObj || typeof entitiesObj !== 'object') return [];

		const results: ProductSearchResult[] = [];
		for (const raw of Object.values(entitiesObj)) {
			if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') continue;
			const p = raw as {
				name: string;
				retailerProductId?: string;
				price?: { current?: { amount?: string; currency?: string } };
				image?: { src?: string };
				images?: string[];
			};
			const price = formatCurrencyPrice(
				p.price?.current?.amount,
				p.price?.current?.currency || 'GBP'
			);
			const imageUrl = sanitizeHttpUrl(p.image?.src || p.images?.[0] || '');
			const sku = p.retailerProductId ? String(p.retailerProductId) : '';
			const productUrl =
				(sku && urlBySku.get(sku)) ||
				`https://groceries.morrisons.com/search?q=${encodeURIComponent(p.name)}`;
			results.push({
				title: p.name.slice(0, 180),
				price,
				imageUrl,
				productUrl,
				store: 'Morrisons',
				source: 'morrisons'
			});
			if (results.length >= limit) break;
		}
		return results;
	} catch {
		return [];
	}
}

export function parseJohnLewisHtml(html: string, limit = 8): ProductSearchResult[] {
	const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
	if (!nextMatch) return [];
	try {
		const data = JSON.parse(nextMatch[1]) as {
			props?: {
				pageProps?: {
					productListingData?: {
						products?: Array<{
							title?: string;
							image?: string;
							url?: string;
							variantPriceRange?: {
								display?: { min?: string; max?: string };
								value?: { min?: string; max?: string };
							};
							price?: { now?: string | number };
						}>;
					};
				};
			};
		};
		const products = data.props?.pageProps?.productListingData?.products ?? [];
		const results: ProductSearchResult[] = [];
		for (const p of products) {
			if (!p.title) continue;
			let imageUrl = '';
			if (p.image) {
				const baseImg = p.image.startsWith('//') ? `https:${p.image}` : p.image;
				imageUrl = baseImg.includes('?')
					? `${baseImg}&wid=400&hei=400`
					: `${baseImg}?wid=400&hei=400`;
				imageUrl = sanitizeHttpUrl(imageUrl);
			}
			const price =
				p.variantPriceRange?.display?.min ||
				formatCurrencyPrice(p.variantPriceRange?.value?.min ?? p.price?.now, 'GBP');
			const productUrl = p.url
				? sanitizeHttpUrl(p.url.startsWith('http') ? p.url : `https://www.johnlewis.com${p.url}`)
				: '';
			if (!productUrl) continue;
			results.push({
				title: p.title.slice(0, 180),
				price,
				imageUrl,
				productUrl,
				store: 'John Lewis',
				source: 'johnlewis'
			});
			if (results.length >= limit) break;
		}
		return results;
	} catch {
		return [];
	}
}

async function searchHotUkDeals(query: string): Promise<ProductSearchResult[]> {
	const res = await fetch(`https://www.hotukdeals.com/search?q=${encodeURIComponent(query)}`, {
		headers: BROWSER_HEADERS,
		signal: AbortSignal.timeout(5500)
	});
	if (!res.ok) return [];
	return parseHotUkDealsHtml(await res.text(), 8);
}

async function searchMorrisons(query: string): Promise<ProductSearchResult[]> {
	const res = await fetch(`https://groceries.morrisons.com/search?q=${encodeURIComponent(query)}`, {
		headers: BROWSER_HEADERS,
		signal: AbortSignal.timeout(5500)
	});
	if (!res.ok) return [];
	return parseMorrisonsHtml(await res.text(), 8);
}

async function searchJohnLewis(query: string): Promise<ProductSearchResult[]> {
	const res = await fetch(
		`https://www.johnlewis.com/search?search-term=${encodeURIComponent(query)}`,
		{ headers: BROWSER_HEADERS, signal: AbortSignal.timeout(5500) }
	);
	if (!res.ok) return [];
	return parseJohnLewisHtml(await res.text(), 8);
}

async function searchItunesUk(query: string): Promise<ProductSearchResult[]> {
	const res = await fetch(
		`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=gb&limit=6`,
		{ headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5500) }
	);
	if (!res.ok) return [];
	const data = (await res.json()) as {
		results?: Array<{
			trackName?: string;
			collectionName?: string;
			artistName?: string;
			trackPrice?: number;
			collectionPrice?: number;
			price?: number;
			currency?: string;
			artworkUrl100?: string;
			trackViewUrl?: string;
			collectionViewUrl?: string;
		}>;
	};
	const out: ProductSearchResult[] = [];
	for (const r of data.results ?? []) {
		const rawTitle = r.trackName || r.collectionName;
		const productUrl = sanitizeHttpUrl(r.trackViewUrl || r.collectionViewUrl || '');
		if (!rawTitle || !productUrl) continue;
		const title = r.artistName ? `${rawTitle} — ${r.artistName}` : rawTitle;
		const amount = r.trackPrice ?? r.collectionPrice ?? r.price;
		const price = amount && amount > 0 ? formatCurrencyPrice(amount, r.currency || 'GBP') : '';
		const imageUrl = r.artworkUrl100
			? sanitizeHttpUrl(r.artworkUrl100.replace('100x100bb', '400x400bb'))
			: '';
		out.push({
			title: title.slice(0, 180),
			price,
			imageUrl,
			productUrl,
			store: 'Apple UK',
			source: 'itunes'
		});
	}
	return out;
}

export async function searchUkProducts(
	query: string,
	source: ProductSource = 'all'
): Promise<ProductSearchResult[]> {
	const q = query.trim();
	if (q.length < 2) return [];

	const tasks: Promise<ProductSearchResult[]>[] = [];
	if (source === 'all' || source === 'hotukdeals') tasks.push(searchHotUkDeals(q));
	if (source === 'all' || source === 'johnlewis') tasks.push(searchJohnLewis(q));
	if (source === 'all' || source === 'morrisons') tasks.push(searchMorrisons(q));
	if (source === 'all' || source === 'itunes') tasks.push(searchItunesUk(q));

	const settled = await Promise.allSettled(tasks);
	const buckets = settled
		.filter((r): r is PromiseFulfilledResult<ProductSearchResult[]> => r.status === 'fulfilled')
		.map((r) => r.value);

	// Interleave results across stores when querying "all" so users see diverse UK stores first.
	const merged: ProductSearchResult[] = [];
	const maxLen = Math.max(0, ...buckets.map((b) => b.length));
	for (let i = 0; i < maxLen; i++) {
		for (const bucket of buckets) {
			if (bucket[i]) merged.push(bucket[i]);
		}
	}
	return merged.slice(0, 24);
}

function extractMeta(html: string, keys: string[]): string {
	for (const key of keys) {
		const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const re1 = new RegExp(
			`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
			'i'
		);
		const re2 = new RegExp(
			`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
			'i'
		);
		const m = html.match(re1) || html.match(re2);
		if (m?.[1]) return decodeEntities(m[1]);
	}
	return '';
}

function extractJsonLdProduct(html: string): Partial<ProductSearchResult> {
	for (const m of html.matchAll(
		/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis
	)) {
		try {
			const parsed = JSON.parse(m[1]) as unknown;
			const nodes = Array.isArray(parsed)
				? parsed
				: typeof parsed === 'object' && parsed && '@graph' in parsed
					? ((parsed as { '@graph'?: unknown[] })['@graph'] ?? [])
					: [parsed];
			for (const node of nodes) {
				if (!node || typeof node !== 'object') continue;
				const obj = node as Record<string, unknown>;
				const typeVal = obj['@type'];
				const isProduct =
					typeVal === 'Product' || (Array.isArray(typeVal) && typeVal.includes('Product'));
				if (!isProduct) continue;

				const title = typeof obj.name === 'string' ? decodeEntities(obj.name).slice(0, 180) : '';
				let imageUrl = '';
				if (typeof obj.image === 'string') imageUrl = sanitizeHttpUrl(obj.image);
				else if (Array.isArray(obj.image) && typeof obj.image[0] === 'string') {
					imageUrl = sanitizeHttpUrl(obj.image[0]);
				} else if (
					obj.image &&
					typeof obj.image === 'object' &&
					typeof (obj.image as { url?: unknown }).url === 'string'
				) {
					imageUrl = sanitizeHttpUrl((obj.image as { url: string }).url);
				}

				const offersRaw = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
				let price = '';
				if (offersRaw && typeof offersRaw === 'object') {
					const o = offersRaw as {
						price?: unknown;
						lowPrice?: unknown;
						priceCurrency?: string;
					};
					price = formatCurrencyPrice(o.price ?? o.lowPrice, o.priceCurrency || 'GBP');
				}
				return { title, imageUrl, price };
			}
		} catch {
			/* ignore invalid JSON-LD block */
		}
	}
	return {};
}

export function extractProductFromHtml(html: string, url: string): ProductSearchResult {
	const store = inferStoreName(url);

	// 1. HotUKDeals single deal page uses data-vue3 JSON
	if (/hotukdeals\.com/i.test(store)) {
		const hItems = parseHotUkDealsHtml(html, 1);
		if (hItems[0]) return { ...hItems[0], productUrl: url, source: 'url' };
	}

	// 2. JSON-LD Product + OpenGraph fallback
	const ld = extractJsonLdProduct(html);
	const ogTitle = extractMeta(html, ['og:title', 'twitter:title']);
	const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '';
	const title = (ld.title || ogTitle || decodeEntities(titleTag) || titleFromProductUrl(url)).slice(
		0,
		180
	);

	const ogImage = sanitizeHttpUrl(
		extractMeta(html, ['og:image', 'og:image:secure_url', 'twitter:image'])
	);
	const imageUrl = ld.imageUrl || ogImage;

	const metaPrice = extractMeta(html, ['product:price:amount', 'og:price:amount', 'twitter:data1']);
	const metaCurrency = extractMeta(html, ['product:price:currency', 'og:price:currency']) || 'GBP';
	const price = ld.price || formatCurrencyPrice(metaPrice, metaCurrency);

	return {
		title,
		price,
		imageUrl,
		productUrl: url,
		store: store || extractMeta(html, ['og:site_name']),
		source: 'url'
	};
}

export async function lookupProductUrl(rawUrl: string): Promise<ProductSearchResult | null> {
	const parsed = isAllowedExternalUrl(rawUrl.trim());
	if (!parsed) return null;
	const cleanUrl = parsed.toString();
	const store = inferStoreName(cleanUrl);

	// Try Shopify product JSON endpoint first when URL looks like a Shopify product page
	if (/\/products\/[^/?#]+/i.test(parsed.pathname) && !/morrisons\.com/i.test(parsed.hostname)) {
		try {
			const jsonUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}.json`;
			const sr = await fetch(jsonUrl, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(4000)
			});
			if (sr.ok && sr.headers.get('content-type')?.includes('json')) {
				const sData = (await sr.json()) as {
					product?: {
						title?: string;
						vendor?: string;
						image?: { src?: string };
						images?: Array<{ src?: string }>;
						variants?: Array<{ price?: string }>;
					};
				};
				if (sData.product?.title) {
					return {
						title: sData.product.title.slice(0, 180),
						price: formatCurrencyPrice(sData.product.variants?.[0]?.price, 'GBP'),
						imageUrl: sanitizeHttpUrl(
							sData.product.image?.src || sData.product.images?.[0]?.src || ''
						),
						productUrl: cleanUrl,
						store: store || sData.product.vendor || parsed.hostname,
						source: 'url'
					};
				}
			}
		} catch {
			/* fall through to HTML parsing */
		}
	}

	try {
		const res = await fetch(cleanUrl, {
			headers: BROWSER_HEADERS,
			signal: AbortSignal.timeout(6000)
		});
		if (!res.ok) {
			return {
				title: titleFromProductUrl(cleanUrl),
				price: '',
				imageUrl: '',
				productUrl: cleanUrl,
				store,
				source: 'url',
				blocked: true
			};
		}
		const html = await res.text();
		const extracted = extractProductFromHtml(html, cleanUrl);
		if (!extracted.title) {
			return {
				title: titleFromProductUrl(cleanUrl),
				price: extracted.price,
				imageUrl: extracted.imageUrl,
				productUrl: cleanUrl,
				store,
				source: 'url',
				blocked: true
			};
		}
		return extracted;
	} catch {
		return {
			title: titleFromProductUrl(cleanUrl),
			price: '',
			imageUrl: '',
			productUrl: cleanUrl,
			store,
			source: 'url',
			blocked: true
		};
	}
}

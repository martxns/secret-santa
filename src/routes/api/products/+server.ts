import { json } from '@sveltejs/kit';
import { isSiteAdmin, joinedPartyIds } from '#lib/server/auth.ts';
import { lookupProductUrl, searchUkProducts } from '#lib/server/products.ts';
import type { ProductSource } from '#lib/wishlist.ts';
import type { RequestHandler } from './$types';

const SOURCES: readonly ProductSource[] = ['all', 'hotukdeals', 'morrisons', 'johnlewis', 'itunes'];

export const GET: RequestHandler = async (event) => {
	if (!joinedPartyIds(event.cookies).length && !isSiteAdmin(event.cookies)) {
		return json({ error: 'forbidden' }, { status: 401 });
	}

	const urlParam = event.url.searchParams.get('url')?.trim() ?? '';
	if (urlParam) {
		const item = await lookupProductUrl(urlParam);
		if (!item) return json({ error: 'invalid_url' }, { status: 400 });
		return json({ item });
	}

	const q = event.url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ items: [] });

	const rawSource = event.url.searchParams.get('source') ?? 'all';
	const source: ProductSource = (SOURCES as readonly string[]).includes(rawSource)
		? (rawSource as ProductSource)
		: 'all';

	const items = await searchUkProducts(q, source);
	return json({ items });
};

import { describe, expect, it } from 'vitest';
import {
	extractProductFromHtml,
	isAllowedExternalUrl,
	parseHotUkDealsHtml,
	parseJohnLewisHtml,
	parseMorrisonsHtml
} from './products.ts';
import {
	formatCurrencyPrice,
	inferStoreName,
	sanitizeHttpUrl,
	titleFromProductUrl
} from '#lib/wishlist.ts';

describe('UK wishlist product helpers', () => {
	it('infers store names for popular UK retailers', () => {
		expect(inferStoreName('https://www.amazon.co.uk/dp/B09V3KXJPB')).toBe('Amazon UK');
		expect(inferStoreName('https://www.tesco.com/groceries/en-GB/products/123')).toBe('Tesco');
		expect(inferStoreName('https://groceries.morrisons.com/products/tea/12345')).toBe('Morrisons');
		expect(inferStoreName('https://www.hotukdeals.com/deals/lego-star-wars-12345')).toBe(
			'HotUKDeals'
		);
		expect(inferStoreName('https://www.johnlewis.com/john-lewis-mug/p123')).toBe('John Lewis');
		expect(inferStoreName('https://www.argos.co.uk/product/12345')).toBe('Argos');
	});

	it('extracts readable fallback titles from blocked UK store URLs', () => {
		expect(
			titleFromProductUrl(
				'https://www.amazon.co.uk/LEGO-Speed-Champions-Ferrari-Race/dp/B0CFW2Z63G'
			)
		).toBe('LEGO Speed Champions Ferrari Race');
		expect(
			titleFromProductUrl('https://www.tesco.com/groceries/en-GB/products/lindt-lindor-truffles')
		).toBe('lindt lindor truffles');
	});

	it('formats prices and sanitizes URLs', () => {
		expect(formatCurrencyPrice('19.99', 'GBP')).toBe('£19.99');
		expect(formatCurrencyPrice(25, 'EUR')).toBe('€25.00');
		expect(formatCurrencyPrice('120', 'PLN')).toBe('120.00 zł');
		expect(formatCurrencyPrice('abc', 'GBP')).toBe('');
		expect(sanitizeHttpUrl('javascript:alert(1)')).toBe('');
		expect(sanitizeHttpUrl('https://www.johnlewis.com/gift')).toBe(
			'https://www.johnlewis.com/gift'
		);
	});

	it('rejects private/loopback SSRF URLs and allows public store URLs', () => {
		expect(isAllowedExternalUrl('https://www.amazon.co.uk/dp/B09V3KXJPB')).not.toBeNull();
		expect(isAllowedExternalUrl('http://localhost:3000/secret')).toBeNull();
		expect(isAllowedExternalUrl('http://127.0.0.1/admin')).toBeNull();
		expect(isAllowedExternalUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
		expect(isAllowedExternalUrl('http://10.0.0.1/internal')).toBeNull();
		expect(isAllowedExternalUrl('http://192.168.1.50/router')).toBeNull();
		expect(isAllowedExternalUrl('http://[::1]/')).toBeNull();
		expect(isAllowedExternalUrl('https://user:pass@example.com/item')).toBeNull();
		expect(isAllowedExternalUrl('https://example.com:8443/item')).toBeNull();
	});
});

describe('live UK store HTML parsers', () => {
	it('parses HotUKDeals search cards', () => {
		const payloadActive = JSON.stringify({
			name: 'ThreadMainListItemNormalizer',
			props: {
				thread: {
					threadId: '449911',
					titleSlug: 'lindt-lindor-truffles-at-tesco',
					title: 'Lindt Lindor Milk Chocolate Truffles 200g',
					price: 4.5,
					isExpired: false,
					merchant: { merchantName: 'Tesco' },
					mainImage: { path: 'threads/raw/abc', name: 'lindt', uid: '12345.jpg' }
				}
			}
		}).replaceAll("'", '&#039;');
		const payloadExpired = JSON.stringify({
			name: 'ThreadMainListItemNormalizer',
			props: {
				thread: {
					threadId: '111',
					titleSlug: 'old-deal',
					title: 'Expired Item',
					price: 10,
					isExpired: true
				}
			}
		});
		const html = `<article data-vue3='${payloadActive}'></article><article data-vue3='${payloadExpired}'></article>`;
		const items = parseHotUkDealsHtml(html);
		expect(items).toHaveLength(1);
		expect(items[0]).toEqual({
			title: 'Lindt Lindor Milk Chocolate Truffles 200g',
			price: '£4.50',
			imageUrl: 'https://images.hotukdeals.com/threads/raw/abc/lindt/re/480/qt/90/12345.jpg',
			productUrl: 'https://www.hotukdeals.com/deals/lindt-lindor-truffles-at-tesco-449911',
			store: 'Tesco',
			source: 'hotukdeals'
		});
	});

	it('parses Morrisons initial state products', () => {
		const state = {
			data: {
				products: {
					productEntities: {
						p1: {
							name: 'Morrisons The Best Hot Chocolate',
							retailerProductId: '567890123',
							price: { current: { amount: '3.25', currency: 'GBP' } },
							image: { src: 'https://groceries.morrisons.com/images/hot-choc.jpg' }
						}
					}
				}
			}
		};
		const html = `
			<a href="/products/morrisons-hot-chocolate/567890123">View</a>
			<script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script>
		`;
		const items = parseMorrisonsHtml(html);
		expect(items).toEqual([
			{
				title: 'Morrisons The Best Hot Chocolate',
				price: '£3.25',
				imageUrl: 'https://groceries.morrisons.com/images/hot-choc.jpg',
				productUrl: 'https://groceries.morrisons.com/products/morrisons-hot-chocolate/567890123',
				store: 'Morrisons',
				source: 'morrisons'
			}
		]);
	});

	it('parses John Lewis __NEXT_DATA__ products', () => {
		const nextData = {
			props: {
				pageProps: {
					productListingData: {
						products: [
							{
								title: 'Le Creuset Stoneware Mug 350ml',
								image: '//johnlewis.scene7.com/is/image/JohnLewis/mug123',
								url: '/le-creuset-stoneware-mug/p12345',
								variantPriceRange: { display: { min: '£18.00' } }
							}
						]
					}
				}
			}
		};
		const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
		const items = parseJohnLewisHtml(html);
		expect(items).toEqual([
			{
				title: 'Le Creuset Stoneware Mug 350ml',
				price: '£18.00',
				imageUrl: 'https://johnlewis.scene7.com/is/image/JohnLewis/mug123?wid=400&hei=400',
				productUrl: 'https://www.johnlewis.com/le-creuset-stoneware-mug/p12345',
				store: 'John Lewis',
				source: 'johnlewis'
			}
		]);
	});

	it('extracts JSON-LD Product details and falls back to OpenGraph tags', () => {
		const ldHtml = `
			<html><head>
			<script type="application/ld+json">
			{"@context":"https://schema.org","@type":"Product","name":"Whittard Christmas Tea","image":["https://cdn.example.com/tea.jpg"],"offers":{"price":"14.50","priceCurrency":"GBP"}}
			</script>
			</head></html>
		`;
		expect(extractProductFromHtml(ldHtml, 'https://www.whittard.co.uk/tea')).toEqual({
			title: 'Whittard Christmas Tea',
			price: '£14.50',
			imageUrl: 'https://cdn.example.com/tea.jpg',
			productUrl: 'https://www.whittard.co.uk/tea',
			store: 'whittard.co.uk',
			source: 'url'
		});

		const ogHtml = `
			<html><head>
			<meta property="og:title" content="Argos Cozy Throw" />
			<meta property="og:image" content="https://media.argos.co.uk/throw.jpg" />
			<meta property="product:price:amount" content="22" />
			<meta property="product:price:currency" content="GBP" />
			</head></html>
		`;
		expect(extractProductFromHtml(ogHtml, 'https://www.argos.co.uk/product/999')).toEqual({
			title: 'Argos Cozy Throw',
			price: '£22.00',
			imageUrl: 'https://media.argos.co.uk/throw.jpg',
			productUrl: 'https://www.argos.co.uk/product/999',
			store: 'Argos',
			source: 'url'
		});
	});
});

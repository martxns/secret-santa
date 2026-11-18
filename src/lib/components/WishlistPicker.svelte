<script lang="ts">
	import { enhance } from '$app/forms';
	import { m } from '#lib/paraglide/messages.js';
	import {
		sanitizeHttpUrl,
		type ProductSearchResult,
		type ProductSource,
		type PublicWishlistItem
	} from '#lib/wishlist.ts';

	let {
		archived = false,
		existingItems = []
	}: {
		archived?: boolean;
		existingItems?: PublicWishlistItem[];
	} = $props();

	type Tab = 'search' | 'link' | 'manual';
	let activeTab = $state<Tab>('search');

	// Search UK stores state
	let query = $state('');
	let source = $state<ProductSource>('all');
	let searching = $state(false);
	let searchDone = $state(false);
	let searchError = $state('');
	let results = $state<ProductSearchResult[]>([]);
	let brokenImages = $state<Record<string, boolean>>({});
	let addingKey = $state<string | null>(null);
	let recentlyAdded = $state<Record<string, boolean>>({});

	// URL lookup state
	let urlInput = $state('');
	let urlFetching = $state(false);
	let urlError = $state('');
	let urlBlocked = $state(false);
	let urlReady = $state(false);
	let draftTitle = $state('');
	let draftPrice = $state('');
	let draftStore = $state('');
	let draftImage = $state('');
	let draftUrl = $state('');
	let draftNote = $state('');

	// Manual add state
	let manualTitle = $state('');
	let manualPrice = $state('');
	let manualStore = $state('');
	let manualUrl = $state('');
	let manualImage = $state('');
	let manualNote = $state('');
	let submittingManual = $state(false);

	function itemKey(item: { title: string; productUrl?: string }) {
		return `${item.productUrl || ''}::${item.title.trim().toLowerCase()}`;
	}

	const existingKeySet = $derived(new Set(existingItems.map((it) => itemKey(it))));

	function isAlreadyAdded(item: ProductSearchResult) {
		const k = itemKey(item);
		return existingKeySet.has(k) || !!recentlyAdded[k];
	}

	function markImageBroken(url: string) {
		if (!url || brokenImages[url]) return;
		brokenImages = { ...brokenImages, [url]: true };
	}

	async function runSearch(e?: SubmitEvent) {
		e?.preventDefault();
		const q = query.trim();
		if (q.length < 2 || searching) return;
		searching = true;
		searchError = '';
		try {
			const res = await fetch(
				`/api/products?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}`
			);
			if (!res.ok) {
				searchError = m.err_invalid();
				results = [];
			} else {
				const data = (await res.json()) as { items?: ProductSearchResult[] };
				results = data.items ?? [];
			}
			searchDone = true;
		} catch {
			searchError = m.error_generic();
			results = [];
			searchDone = true;
		} finally {
			searching = false;
		}
	}

	async function runUrlLookup(e?: SubmitEvent) {
		e?.preventDefault();
		const clean = sanitizeHttpUrl(urlInput);
		if (!clean) {
			urlError = m.wishlist_url_invalid();
			return;
		}
		urlFetching = true;
		urlError = '';
		urlBlocked = false;
		urlReady = false;
		try {
			const res = await fetch(`/api/products?url=${encodeURIComponent(clean)}`);
			if (!res.ok) {
				urlError = m.wishlist_url_invalid();
				return;
			}
			const data = (await res.json()) as { item?: ProductSearchResult | null };
			if (!data.item) {
				urlError = m.wishlist_url_invalid();
				return;
			}
			const r = data.item;
			draftTitle = r.title;
			draftPrice = r.price;
			draftStore = r.store;
			draftImage = r.imageUrl;
			draftUrl = r.productUrl;
			draftNote = '';
			urlBlocked = !!r.blocked;
			urlReady = true;
		} catch {
			urlError = m.error_generic();
		} finally {
			urlFetching = false;
		}
	}
</script>

<div class="rounded-2xl border border-ink/10 bg-paper-2/45 p-4">
	<!-- Mode tabs -->
	<div class="flex flex-wrap gap-2" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'search'}
			class={activeTab === 'search'
				? 'btn-pine btn-sm whitespace-nowrap'
				: 'btn-ghost btn-sm whitespace-nowrap'}
			onclick={() => (activeTab = 'search')}
			disabled={archived}
		>
			🔍 {m.wishlist_search_tab()}
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'link'}
			class={activeTab === 'link'
				? 'btn-pine btn-sm whitespace-nowrap'
				: 'btn-ghost btn-sm whitespace-nowrap'}
			onclick={() => (activeTab = 'link')}
			disabled={archived}
		>
			🔗 {m.wishlist_link_tab()}
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'manual'}
			class={activeTab === 'manual'
				? 'btn-pine btn-sm whitespace-nowrap'
				: 'btn-ghost btn-sm whitespace-nowrap'}
			onclick={() => (activeTab = 'manual')}
			disabled={archived}
		>
			✏️ {m.wishlist_manual_tab()}
		</button>
	</div>

	{#if activeTab === 'search'}
		<form class="mt-4 flex flex-col gap-2 sm:flex-row" onsubmit={runSearch}>
			<input
				type="search"
				class="input flex-1"
				placeholder={m.wishlist_search_ph()}
				aria-label={m.wishlist_search_tab()}
				bind:value={query}
				minlength="2"
				maxlength="120"
				disabled={archived}
			/>
			<select
				class="input sm:w-52"
				aria-label={m.wishlist_item_store()}
				bind:value={source}
				disabled={archived}
			>
				<option value="all">{m.wishlist_source_all()}</option>
				<option value="hotukdeals">{m.wishlist_source_hotukdeals()}</option>
				<option value="morrisons">{m.wishlist_source_morrisons()}</option>
				<option value="johnlewis">{m.wishlist_source_johnlewis()}</option>
				<option value="itunes">{m.wishlist_source_itunes()}</option>
			</select>
			<button
				type="submit"
				class="btn-pine shrink-0 whitespace-nowrap"
				disabled={archived || searching || query.trim().length < 2}
			>
				{searching ? m.wishlist_searching() : m.wishlist_search_btn()}
			</button>
		</form>
		<p class="mt-2 text-xs text-ink-soft">{m.wishlist_search_hint()}</p>

		{#if searchError}
			<p class="mt-3 error" role="alert">{searchError}</p>
		{:else if searching}
			<div class="mt-4 grid gap-3 sm:grid-cols-2" aria-busy="true">
				{#each [1, 2, 3, 4] as n (n)}
					<div class="animate-pulse rounded-2xl border border-ink/10 bg-snow/70 p-3">
						<div class="h-32 rounded-xl bg-paper-2"></div>
						<div class="mt-3 h-3 w-20 rounded bg-paper-2"></div>
						<div class="mt-2 h-4 w-full rounded bg-paper-2"></div>
						<div class="mt-2 h-4 w-16 rounded bg-paper-2"></div>
					</div>
				{/each}
			</div>
		{:else if searchDone && !results.length}
			<p class="mt-4 rounded-2xl bg-snow/60 px-4 py-3 text-sm text-ink-soft">
				{m.wishlist_search_empty()}
			</p>
		{:else if results.length}
			<ul class="mt-4 grid gap-3 sm:grid-cols-2">
				{#each results as item (`${item.productUrl}:${item.title}`)}
					{@const k = itemKey(item)}
					{@const added = isAlreadyAdded(item)}
					<li
						class="flex flex-col justify-between overflow-hidden rounded-2xl border border-ink/10 bg-snow/95 p-3 shadow-xs"
					>
						<div>
							<div
								class="flex h-36 items-center justify-center overflow-hidden rounded-xl bg-white p-2 ring-1 ring-ink/5"
							>
								{#if item.imageUrl && !brokenImages[item.imageUrl]}
									<img
										src={item.imageUrl}
										alt={item.title}
										class="max-h-full max-w-full object-contain"
										loading="lazy"
										referrerpolicy="no-referrer"
										onerror={() => markImageBroken(item.imageUrl)}
									/>
								{:else}
									<span class="text-4xl" aria-hidden="true">🎁</span>
								{/if}
							</div>
							{#if item.store}
								<p class="mt-2.5 text-[11px] font-bold tracking-wider text-ink-soft uppercase">
									{item.store}
								</p>
							{/if}
							<h3 class="mt-0.5 line-clamp-2 font-sans text-sm leading-snug font-semibold text-ink">
								{item.title}
							</h3>
							{#if item.price}
								<p class="mt-1 text-base font-bold text-pine tabular-nums">{item.price}</p>
							{/if}
						</div>

						<div
							class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-2"
						>
							{#if item.productUrl}
								<a
									href={item.productUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="text-xs font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
								>
									{m.wishlist_view_item()} ↗
								</a>
							{/if}
							<form
								method="POST"
								action="?/addWishlistItem"
								use:enhance={() => {
									addingKey = k;
									return async ({ result, update }) => {
										addingKey = null;
										if (result.type === 'success') {
											recentlyAdded = { ...recentlyAdded, [k]: true };
										}
										await update({ reset: false });
									};
								}}
							>
								<input type="hidden" name="title" value={item.title} />
								<input type="hidden" name="price" value={item.price} />
								<input type="hidden" name="imageUrl" value={item.imageUrl} />
								<input type="hidden" name="productUrl" value={item.productUrl} />
								<input type="hidden" name="store" value={item.store} />
								<button
									type="submit"
									class={added
										? 'btn-ghost btn-sm whitespace-nowrap'
										: 'btn-pine btn-sm whitespace-nowrap'}
									disabled={archived || addingKey === k}
								>
									{#if added}
										✓ {m.wishlist_item_added()}
									{:else}
										+ {m.wishlist_item_add()}
									{/if}
								</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if activeTab === 'link'}
		<form class="mt-4 flex flex-col gap-2 sm:flex-row" onsubmit={runUrlLookup}>
			<input
				type="url"
				class="input flex-1"
				placeholder={m.wishlist_url_ph()}
				aria-label={m.wishlist_link_tab()}
				bind:value={urlInput}
				disabled={archived}
				required
			/>
			<button
				type="submit"
				class="btn-pine shrink-0 whitespace-nowrap"
				disabled={archived || urlFetching || !urlInput.trim()}
			>
				{urlFetching ? m.wishlist_url_fetching() : m.wishlist_url_btn()}
			</button>
		</form>
		{#if urlError}
			<p class="mt-3 error" role="alert">{urlError}</p>
		{/if}

		{#if urlReady}
			{#if urlBlocked}
				<p class="mt-3 rounded-2xl border border-gold/50 bg-gold-2/20 px-4 py-2.5 text-xs text-ink">
					ℹ️ {m.wishlist_url_blocked()}
				</p>
			{/if}
			<form
				method="POST"
				action="?/addWishlistItem"
				class="mt-4 space-y-3 rounded-2xl border border-ink/10 bg-snow/90 p-4"
				use:enhance={() => {
					submittingManual = true;
					return async ({ result, update }) => {
						submittingManual = false;
						if (result.type === 'success') {
							urlInput = '';
							urlReady = false;
							urlBlocked = false;
							draftTitle = '';
							draftPrice = '';
							draftStore = '';
							draftImage = '';
							draftUrl = '';
							draftNote = '';
						}
						await update({ reset: false });
					};
				}}
			>
				<div class="flex flex-col gap-4 sm:flex-row">
					<div
						class="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-2 ring-1 ring-ink/10"
					>
						{#if sanitizeHttpUrl(draftImage) && !brokenImages[draftImage]}
							<img
								src={sanitizeHttpUrl(draftImage)}
								alt={draftTitle || m.wishlist_item_title()}
								class="max-h-full max-w-full object-contain"
								referrerpolicy="no-referrer"
								onerror={() => markImageBroken(draftImage)}
							/>
						{:else}
							<span class="text-4xl" aria-hidden="true">🎁</span>
						{/if}
					</div>
					<div class="min-w-0 flex-1 space-y-3">
						<div>
							<label class="label" for="url-item-title">{m.wishlist_item_title()}</label>
							<input
								id="url-item-title"
								name="title"
								class="input"
								maxlength="180"
								required
								bind:value={draftTitle}
							/>
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label class="label" for="url-item-price">{m.wishlist_item_price()}</label>
								<input
									id="url-item-price"
									name="price"
									class="input"
									maxlength="40"
									bind:value={draftPrice}
								/>
							</div>
							<div>
								<label class="label" for="url-item-store">{m.wishlist_item_store()}</label>
								<input
									id="url-item-store"
									name="store"
									class="input"
									maxlength="80"
									bind:value={draftStore}
								/>
							</div>
						</div>
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="label" for="url-item-link">{m.wishlist_item_link()}</label>
						<input
							id="url-item-link"
							name="productUrl"
							type="url"
							class="input"
							maxlength="1000"
							bind:value={draftUrl}
						/>
					</div>
					<div>
						<label class="label" for="url-item-image">{m.wishlist_item_image()}</label>
						<input
							id="url-item-image"
							name="imageUrl"
							type="url"
							class="input"
							maxlength="1000"
							bind:value={draftImage}
						/>
					</div>
				</div>
				<div>
					<label class="label" for="url-item-note">{m.wishlist_item_note()}</label>
					<input
						id="url-item-note"
						name="note"
						class="input"
						maxlength="300"
						placeholder={m.wishlist_item_note_ph()}
						bind:value={draftNote}
					/>
				</div>
				<button type="submit" class="btn-pine btn-sm" disabled={archived || submittingManual}>
					+ {m.wishlist_item_add()}
				</button>
			</form>
		{/if}
	{:else}
		<form
			method="POST"
			action="?/addWishlistItem"
			class="mt-4 space-y-3 rounded-2xl border border-ink/10 bg-snow/90 p-4"
			use:enhance={() => {
				submittingManual = true;
				return async ({ result, update }) => {
					submittingManual = false;
					if (result.type === 'success') {
						manualTitle = '';
						manualPrice = '';
						manualStore = '';
						manualUrl = '';
						manualImage = '';
						manualNote = '';
					}
					await update({ reset: false });
				};
			}}
		>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="label" for="manual-item-title">{m.wishlist_item_title()}</label>
					<input
						id="manual-item-title"
						name="title"
						class="input"
						maxlength="180"
						required
						disabled={archived}
						bind:value={manualTitle}
					/>
				</div>
				<div>
					<label class="label" for="manual-item-price">{m.wishlist_item_price()}</label>
					<input
						id="manual-item-price"
						name="price"
						class="input"
						maxlength="40"
						disabled={archived}
						bind:value={manualPrice}
					/>
				</div>
				<div>
					<label class="label" for="manual-item-store">{m.wishlist_item_store()}</label>
					<input
						id="manual-item-store"
						name="store"
						class="input"
						maxlength="80"
						placeholder="Amazon UK, Tesco, Morrisons…"
						disabled={archived}
						bind:value={manualStore}
					/>
				</div>
				<div>
					<label class="label" for="manual-item-link">{m.wishlist_item_link()}</label>
					<input
						id="manual-item-link"
						name="productUrl"
						type="url"
						class="input"
						maxlength="1000"
						disabled={archived}
						bind:value={manualUrl}
					/>
				</div>
				<div>
					<label class="label" for="manual-item-image">{m.wishlist_item_image()}</label>
					<input
						id="manual-item-image"
						name="imageUrl"
						type="url"
						class="input"
						maxlength="1000"
						disabled={archived}
						bind:value={manualImage}
					/>
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="manual-item-note">{m.wishlist_item_note()}</label>
					<input
						id="manual-item-note"
						name="note"
						class="input"
						maxlength="300"
						placeholder={m.wishlist_item_note_ph()}
						disabled={archived}
						bind:value={manualNote}
					/>
				</div>
			</div>
			<button type="submit" class="btn-pine btn-sm" disabled={archived || submittingManual}>
				+ {m.wishlist_item_add()}
			</button>
		</form>
	{/if}
</div>

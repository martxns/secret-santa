<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { PublicWishlistItem } from '#lib/wishlist.ts';

	let { text, items = [] }: { text: string; items?: PublicWishlistItem[] } = $props();
	let shown = $state(false);
	const hasAny = $derived(!!text.trim() || items.length > 0);
	const maskLen = $derived(
		Math.min(18, 6 + ((text.length + items.reduce((n, i) => n + i.title.length, 0)) % 12))
	);
</script>

<div class="flex items-start gap-3">
	<div class="min-w-0 flex-1 rounded-2xl bg-paper-2/70 px-3 py-2 text-sm whitespace-pre-wrap">
		{#if !hasAny}
			<span class="text-ink-soft italic">{m.wishlist_empty()}</span>
		{:else if shown}
			{#if items.length}
				<ul class="space-y-1.5">
					{#each items as item (item.id)}
						<li class="flex flex-wrap items-baseline gap-x-2 text-xs">
							<span class="font-semibold text-ink">🎁 {item.title}</span>
							{#if item.price}
								<span class="font-bold text-pine tabular-nums">{item.price}</span>
							{/if}
							{#if item.store}
								<span class="text-ink-soft">({item.store})</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if text.trim()}
				<p class={items.length ? 'mt-2 border-t border-ink/10 pt-2' : ''}>{text}</p>
			{/if}
		{:else}
			<span class="tracking-widest text-ink-soft select-none">{'•'.repeat(maskLen)}</span>
		{/if}
	</div>
	{#if hasAny}
		<button type="button" class="btn-ghost btn-sm" onclick={() => (shown = !shown)}>
			{shown ? m.hide() : m.reveal()}
		</button>
	{/if}
</div>

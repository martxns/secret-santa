<script lang="ts">
	import { enhance } from '$app/forms';
	import { m } from '#lib/paraglide/messages.js';
	import { displayName, fullName, type NamedMember } from '#lib/names.ts';
	import type { PublicWishlistItem } from '#lib/wishlist.ts';
	import Avatar from './Avatar.svelte';

	let {
		receiver,
		alreadyRevealed = false
	}: {
		receiver: NamedMember & {
			id: string;
			avatar: string | null;
			wishlist: string;
			wishlistItems?: PublicWishlistItem[];
		};
		alreadyRevealed?: boolean;
	} = $props();
	let open = $state(false);
	let reported = $state(false);
	let brokenImages = $state<Record<string, boolean>>({});
	const items = $derived(receiver.wishlistItems ?? []);
</script>

<section
	class="relative overflow-hidden rounded-[2rem] border-4 border-gold-2 bg-ribbon p-6 text-cream shadow-[0_25px_50px_-25px_#5a1016] sm:p-8"
>
	<div
		class="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 bg-gold-2/90"
		aria-hidden="true"
		class:hidden={open}
	></div>
	<div
		class="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 bg-gold-2/90"
		aria-hidden="true"
		class:hidden={open}
	></div>

	{#if !open}
		<div class="relative flex flex-col items-center gap-4 py-6 text-center">
			<span class="text-6xl drop-shadow-lg" aria-hidden="true">🎁</span>
			<p class="rounded-full bg-ribbon-2/90 px-4 py-1 font-display text-2xl font-bold">
				{m.reveal_title()}
			</p>
			<form
				method="POST"
				action="?/reveal"
				use:enhance={({ cancel }) => {
					open = true;
					if (reported || alreadyRevealed) {
						cancel();
						return;
					}
					reported = true;
					return async ({ result }) => {
						if (result.type !== 'success') reported = false;
					};
				}}
			>
				<button
					type="submit"
					class="btn rounded-full bg-cream text-ribbon shadow-[0_3px_0_#e9c36a] hover:bg-[#f7f0e3]"
				>
					✨ {m.reveal_open()}
				</button>
			</form>
			<p class="max-w-xs rounded-xl bg-ribbon-2/80 px-3 py-1 text-xs text-cream/90">
				{m.reveal_hint()}
			</p>
		</div>
	{:else}
		<div class="relative animate-rise">
			<p class="text-xs font-bold tracking-[0.25em] text-gold-2 uppercase">{m.reveal_you_give()}</p>
			<div class="mt-4 flex items-center gap-4">
				<Avatar member={receiver} size={84} ring />
				<div>
					<p class="font-display text-4xl leading-none font-black">{displayName(receiver)}</p>
					{#if fullName(receiver) !== displayName(receiver)}
						<p class="mt-1 text-cream/80">{fullName(receiver)}</p>
					{/if}
				</div>
			</div>
			<div class="mt-6 rounded-2xl bg-cream p-4 text-[#2b1d17]">
				<p class="text-xs font-bold tracking-wider text-ribbon uppercase">
					📝 {m.their_wishlist()}
				</p>

				{#if items.length}
					<ul class="mt-3 grid gap-3 sm:grid-cols-2">
						{#each items as item (item.id)}
							<li
								class="flex gap-3 rounded-xl border border-[#2b1d17]/10 bg-white/90 p-3 shadow-xs"
							>
								<div
									class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 ring-1 ring-[#2b1d17]/10"
								>
									{#if item.imageUrl && !brokenImages[item.imageUrl]}
										<img
											src={item.imageUrl}
											alt={item.title}
											class="max-h-full max-w-full object-contain"
											loading="lazy"
											referrerpolicy="no-referrer"
											onerror={() => (brokenImages = { ...brokenImages, [item.imageUrl]: true })}
										/>
									{:else}
										<span class="text-2xl" aria-hidden="true">🎁</span>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									{#if item.store}
										<p class="text-[11px] font-bold tracking-wider text-[#6b5a4e] uppercase">
											{item.store}
										</p>
									{/if}
									<p class="line-clamp-2 text-sm leading-snug font-semibold text-[#2b1d17]">
										{item.title}
									</p>
									{#if item.price}
										<p class="mt-0.5 text-sm font-bold text-[#17382a] tabular-nums">
											{item.price}
										</p>
									{/if}
									{#if item.note}
										<p class="mt-1 text-xs text-[#6b5a4e]">{item.note}</p>
									{/if}
									{#if item.productUrl}
										<a
											href={item.productUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="mt-1.5 inline-block text-xs font-semibold text-ribbon underline underline-offset-2"
										>
											{m.wishlist_view_item()} ↗
										</a>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				{#if receiver.wishlist.trim()}
					<p class="mt-3 whitespace-pre-wrap">{receiver.wishlist}</p>
				{:else if !items.length}
					<p class="mt-2 whitespace-pre-wrap">{m.wishlist_empty_theirs()}</p>
				{/if}
			</div>
			<button
				class="mt-4 text-sm font-semibold text-cream/80 underline underline-offset-2"
				onclick={() => (open = false)}
			>
				🙈 {m.reveal_close()}
			</button>
		</div>
	{/if}
</section>

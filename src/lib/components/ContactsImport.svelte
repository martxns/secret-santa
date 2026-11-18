<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { m } from '#lib/paraglide/messages.js';
	import { locales } from '#lib/paraglide/runtime.js';
	import { LANGUAGES } from '#lib/languages.ts';
	import { displayName, fullName } from '#lib/names.ts';
	import { normalizePhone, parseContactText, parseVcf, type ParsedContact } from '#lib/contacts.ts';

	type MemberItem = {
		id: string;
		firstName: string;
		lastName: string;
		nickname: string;
	};

	type StagedContact = ParsedContact & {
		key: string;
		selected: boolean;
		targetMemberId: string; // '' = create new member
		locale: string;
	};

	let {
		members,
		drawn,
		magicLinksEnabled
	}: {
		members: MemberItem[];
		drawn: boolean;
		magicLinksEnabled: boolean;
	} = $props();

	let supportsPicker = $state(false);
	let pasteText = $state('');
	let staged = $state<StagedContact[]>([]);
	let generateLinks = $state(true);
	let defaultLocale = $state('');
	let parseTouched = $state(false);
	let pickerError = $state('');

	onMount(() => {
		const nav = navigator as Navigator & {
			contacts?: {
				select?: (props: string[], opts?: { multiple?: boolean }) => Promise<unknown[]>;
			};
		};
		supportsPicker = !!(nav.contacts && typeof nav.contacts.select === 'function');
	});

	function autoMatchMemberId(c: ParsedContact): string {
		const full = `${c.firstName} ${c.lastName}`.trim().toLocaleLowerCase();
		const first = c.firstName.trim().toLocaleLowerCase();
		const exact = members.find(
			(mem) =>
				fullName(mem).toLocaleLowerCase() === full ||
				displayName(mem).toLocaleLowerCase() === full ||
				displayName(mem).toLocaleLowerCase() === first
		);
		if (exact) return exact.id;
		const byFirst = members.filter((mem) => mem.firstName.trim().toLocaleLowerCase() === first);
		return byFirst.length === 1 ? byFirst[0].id : '';
	}

	function addContacts(list: ParsedContact[]) {
		parseTouched = true;
		if (!list.length) return;
		const existingPhones = new Set(staged.map((s) => `${s.firstName}:${s.lastName}:${s.phone}`));
		const additions: StagedContact[] = [];
		for (const c of list) {
			const sig = `${c.firstName}:${c.lastName}:${c.phone}`;
			if (existingPhones.has(sig)) continue;
			existingPhones.add(sig);
			const matchedId = autoMatchMemberId(c);
			// If party is already drawn, only allow assigning to existing members
			if (drawn && !matchedId && !members.length) continue;
			additions.push({
				...c,
				key: `${sig}:${staged.length + additions.length}`,
				selected: !drawn || !!matchedId,
				targetMemberId: matchedId || (drawn && members[0] ? members[0].id : ''),
				locale: defaultLocale
			});
		}
		staged = [...staged, ...additions];
	}

	async function pickFromDevice() {
		pickerError = '';
		try {
			const nav = navigator as Navigator & {
				contacts: {
					select: (
						props: string[],
						opts?: { multiple?: boolean }
					) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
				};
			};
			const picked = await nav.contacts.select(['name', 'tel'], { multiple: true });
			const parsed: ParsedContact[] = [];
			for (const entry of picked) {
				const rawName = (entry.name?.[0] ?? '').trim();
				const rawPhone = normalizePhone(entry.tel?.[0] ?? '');
				if (!rawName || !rawPhone) continue;
				const parts = rawName.split(/\s+/).filter(Boolean);
				const firstName = (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]) ?? '';
				const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
				parsed.push({
					firstName: firstName.slice(0, 60),
					lastName: lastName.slice(0, 60),
					nickname: '',
					phone: rawPhone
				});
			}
			addContacts(parsed);
		} catch (e) {
			if ((e as Error)?.name !== 'AbortError') {
				pickerError = m.contacts_none_parsed();
			}
		}
	}

	async function handleFiles(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = input.files;
		if (!files?.length) return;
		const collected: ParsedContact[] = [];
		for (const file of files) {
			const content = await file.text();
			const parsed = /BEGIN:VCARD/i.test(content) ? parseVcf(content) : parseContactText(content);
			collected.push(...parsed);
		}
		addContacts(collected);
		input.value = '';
	}

	function parsePasted() {
		const parsed = parseContactText(pasteText);
		addContacts(parsed);
		if (parsed.length) pasteText = '';
	}

	const selectedPayload = $derived(
		JSON.stringify(
			staged
				.filter((s) => s.selected)
				.map((s) => ({
					mode: s.targetMemberId ? 'assign' : 'create',
					memberId: s.targetMemberId || undefined,
					firstName: s.firstName,
					lastName: s.lastName,
					nickname: s.nickname,
					phone: s.phone,
					locale: s.locale || null,
					generateLink: magicLinksEnabled && generateLinks
				}))
		)
	);
	const selectedCount = $derived(staged.filter((s) => s.selected).length);
</script>

<details class="mt-4 rounded-2xl bg-paper-2/50 p-4">
	<summary class="cursor-pointer font-semibold">📱 {m.contacts_import_title()}</summary>
	<p class="mt-2 text-sm text-ink-soft">{m.contacts_ios_hint()}</p>

	<div class="mt-3 flex flex-wrap gap-2">
		{#if supportsPicker}
			<button type="button" class="btn-pine btn-sm" onclick={pickFromDevice}>
				📲 {m.contacts_pick_button()}
			</button>
		{/if}
		<label class="btn-ghost cursor-pointer btn-sm">
			📂 {m.contacts_vcf_label()}
			<input
				type="file"
				accept=".vcf,.vcard,text/vcard,text/x-vcard,.csv,text/csv,text/plain"
				multiple
				class="sr-only"
				onchange={handleFiles}
			/>
		</label>
	</div>

	<div class="mt-3">
		<label class="label" for="contacts-paste">{m.contacts_paste_label()}</label>
		<div class="flex flex-col gap-2 sm:flex-row">
			<textarea
				id="contacts-paste"
				rows="2"
				class="input flex-1 text-sm"
				placeholder={m.contacts_paste_ph()}
				bind:value={pasteText}></textarea>
			<button
				type="button"
				class="btn-ghost shrink-0 self-start btn-sm"
				disabled={!pasteText.trim()}
				onclick={parsePasted}
			>
				{m.next()}
			</button>
		</div>
	</div>

	{#if pickerError}
		<p class="mt-2 text-xs text-berry">{pickerError}</p>
	{:else if parseTouched && !staged.length}
		<p class="mt-2 text-xs text-ink-soft">{m.contacts_none_parsed()}</p>
	{/if}

	{#if staged.length}
		<form
			method="POST"
			action="?/importContacts"
			class="mt-4 space-y-3 border-t border-ink/10 pt-3"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') {
						staged = [];
						parseTouched = false;
					}
				}}
		>
			<input type="hidden" name="contacts" value={selectedPayload} />
			<ul class="space-y-2">
				{#each staged as item (item.key)}
					<li class="flex flex-col gap-2 rounded-xl bg-snow/80 p-3 sm:flex-row sm:items-center">
						<label class="flex min-w-0 flex-1 items-center gap-2.5">
							<input
								type="checkbox"
								class="h-5 w-5 rounded text-pine"
								bind:checked={item.selected}
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-semibold">
									{[item.firstName, item.lastName].filter(Boolean).join(' ')}
								</span>
								<span class="block font-mono text-xs text-ink-soft tabular-nums">{item.phone}</span>
							</span>
						</label>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<select
								class="input py-1.5 text-sm sm:w-56"
								bind:value={item.targetMemberId}
								aria-label={m.contacts_action_new()}
							>
								{#if !drawn}
									<option value="">➕ {m.contacts_action_new()}</option>
								{/if}
								{#each members as mem (mem.id)}
									<option value={mem.id}>
										{m.contacts_action_assign({ name: fullName(mem) })}
									</option>
								{/each}
							</select>
							<select
								class="input py-1.5 text-sm sm:w-36"
								bind:value={item.locale}
								aria-label={m.member_locale()}
							>
								<option value="">{m.member_locale_auto()}</option>
								{#each locales as loc (loc)}
									<option value={loc}>{LANGUAGES[loc].name}</option>
								{/each}
							</select>
						</div>
					</li>
				{/each}
			</ul>

			{#if magicLinksEnabled}
				<div class="flex flex-wrap items-center gap-4">
					<label class="flex items-center gap-2.5 text-sm">
						<input type="checkbox" class="h-4 w-4 rounded text-pine" bind:checked={generateLinks} />
						<span>{m.contacts_generate_links_opt()}</span>
					</label>
					<label class="flex items-center gap-2 text-sm">
						<span class="text-ink-soft">{m.contacts_default_locale()}:</span>
						<select
							class="input py-1 text-sm"
							value={defaultLocale}
							onchange={(e) => {
								defaultLocale = e.currentTarget.value;
								staged = staged.map((s) => ({ ...s, locale: defaultLocale }));
							}}
						>
							<option value="">{m.member_locale_auto()}</option>
							{#each locales as loc (loc)}
								<option value={loc}>{LANGUAGES[loc].name}</option>
							{/each}
						</select>
					</label>
				</div>
			{/if}

			<div class="flex flex-wrap gap-2">
				<button class="btn-pine btn-sm" disabled={!selectedCount}>
					{m.contacts_apply({ count: String(selectedCount) })}
				</button>
				<button
					type="button"
					class="btn-ghost btn-sm"
					onclick={() => {
						staged = [];
						parseTouched = false;
					}}
				>
					{m.cancel()}
				</button>
			</div>
		</form>
	{/if}
</details>

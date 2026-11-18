<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale, locales, type Locale } from '#lib/paraglide/runtime.js';
	import { LANGUAGES } from '#lib/languages.ts';
	import { TIMEZONE } from '$app/env/public';
	import { errorText } from '#lib/errors.ts';
	import { displayName, fullName } from '#lib/names.ts';
	import { formatDateTime, toInputValue } from '#lib/time.ts';
	import { CURRENCIES } from '#lib/currencies.ts';
	import { buildGroupSmsHref, buildSmsHref, renderSmsMessage } from '#lib/contacts.ts';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import ContactsImport from '#lib/components/ContactsImport.svelte';
	import type { RuleEntry } from '#lib/rules/catalog.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import Obscured from '#lib/components/Obscured.svelte';
	import RuleBuilder from '#lib/components/RuleBuilder.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const party = $derived(data.party);

	let rules = $state<RuleEntry[]>([]);
	$effect.pre(() => {
		rules = structuredClone($state.snapshot(data.rules));
	});
	let currency = $state('PLN');
	$effect.pre(() => {
		currency = party.currency;
	});
	// svelte-ignore state_referenced_locally
	let smsTemplateDraft = $state(data.admin.smsTemplate);
	$effect.pre(() => {
		smsTemplateDraft = data.admin.smsTemplate;
	});

	type UpdatePreset = 'wishlist_reminder' | 'wishlist_new' | 'event_reminder' | 'custom';
	let updateAudience = $state<'all' | 'no_wishlist'>('all');
	let updatePreset = $state<UpdatePreset>('wishlist_reminder');
	function presetTemplateFor(preset: UpdatePreset, loc: Locale): string {
		if (preset === 'wishlist_reminder') {
			return m.updates_tpl_wishlist_reminder({ party: '{party}', link: '{link}' }, { locale: loc });
		}
		if (preset === 'wishlist_new') {
			return m.updates_tpl_wishlist_new({ party: '{party}', link: '{link}' }, { locale: loc });
		}
		if (preset === 'event_reminder') {
			return m.updates_tpl_event_reminder({ party: '{party}', link: '{link}' }, { locale: loc });
		}
		return '';
	}
	let updateMessageDraft = $state(presetTemplateFor('wishlist_reminder', getLocale()));
	function onPresetChange(next: UpdatePreset) {
		updatePreset = next;
		updateMessageDraft = presetTemplateFor(next, getLocale());
	}

	const keep: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });
	const confirmThen =
		(question: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(question)) cancel();
			return async ({ update }) => update({ reset: false });
		};

	const msg = (section: string) =>
		form && 'section' in form && form.section === section
			? { error: form.error as string }
			: form && 'ok' in form && form.ok === section
				? {
						ok: true,
						importedCount:
							'importedCount' in form ? (form.importedCount as number) : undefined,
						pushDevices: 'pushDevices' in form ? (form.pushDevices as number) : undefined,
						pushMembers: 'pushMembers' in form ? (form.pushMembers as number) : undefined
					}
				: null;

	const participants = $derived(data.members.filter((x) => x.participates).length);
	const missingLinks = $derived(data.members.some((x) => !x.magicToken));
	const pushEnabledCount = $derived(data.admin.pushEnabledIds.length);
	const pushEnabledSet = $derived(new Set(data.admin.pushEnabledIds));

	const updateTargets = $derived(
		updateAudience === 'no_wishlist'
			? data.members.filter((x) => !x.wishlist.trim())
			: data.members
	);
	const updateTargetsWithPhone = $derived(updateTargets.filter((x) => !!x.phone.trim()));
	const updateUsingPreset = $derived(
		updatePreset !== 'custom' &&
			updateMessageDraft.trim() === presetTemplateFor(updatePreset, getLocale()).trim()
	);
	const sharedUpdateUrl = $derived(
		updatePreset === 'wishlist_reminder'
			? `${page.url.origin}/p/${party.id}/me`
			: `${page.url.origin}/p/${party.id}`
	);
	const groupUpdateSmsHref = $derived(
		buildGroupSmsHref(
			updateTargetsWithPhone.map((x) => x.phone),
			renderSmsMessage(
				updateUsingPreset ? presetTemplateFor(updatePreset, getLocale()) : updateMessageDraft,
				{ name: '', party: party.name, link: sharedUpdateUrl },
				sharedUpdateUrl
			)
		)
	);

	function memberUpdateSmsHref(member: {
		firstName: string;
		lastName: string;
		nickname: string;
		phone: string;
		magicToken: string | null;
		locale: string | null;
	}) {
		const loc =
			member.locale && (locales as readonly string[]).includes(member.locale)
				? (member.locale as Locale)
				: getLocale();
		const tpl = updateUsingPreset ? presetTemplateFor(updatePreset, loc) : updateMessageDraft;
		const link =
			data.admin.magicLinksEnabled && member.magicToken
				? `${page.url.origin}/p/${member.magicToken}`
				: sharedUpdateUrl;
		const body = renderSmsMessage(
			tpl,
			{ name: displayName(member), party: party.name, link },
			link
		);
		return buildSmsHref(member.phone, body);
	}

	const defaultSmsTemplate = $derived(
		m.sms_template_default({ name: '{name}', party: '{party}', link: '{link}' })
	);

	function memberMagicUrl(token: string | null) {
		return token ? `${page.url.origin}/p/${token}` : '';
	}

	function memberSmsHref(member: {
		firstName: string;
		lastName: string;
		nickname: string;
		phone: string;
		magicToken: string | null;
		locale: string | null;
	}) {
		const url = memberMagicUrl(member.magicToken);
		const memberLocale =
			member.locale && (locales as readonly string[]).includes(member.locale)
				? (member.locale as Locale)
				: getLocale();
		const fallbackTemplate = m.sms_template_default(
			{ name: '{name}', party: '{party}', link: '{link}' },
			{ locale: memberLocale }
		);
		const body = renderSmsMessage(
			smsTemplateDraft,
			{ name: displayName(member), party: party.name, link: url },
			fallbackTemplate
		);
		return buildSmsHref(member.phone, body);
	}

	const smsPreviewText = $derived.by(() => {
		const sample = data.members[0] ?? {
			firstName: 'Anna',
			lastName: '',
			nickname: '',
			magicToken: 'example-token'
		};
		const link = sample.magicToken
			? `${page.url.origin}/p/${sample.magicToken}`
			: `${page.url.origin}/p/example-token`;
		return renderSmsMessage(
			smsTemplateDraft,
			{ name: displayName(sample), party: party.name, link },
			defaultSmsTemplate
		);
	});
</script>

{#snippet feedback(section: string)}
	{@const f = msg(section)}
	{#if f?.error}<p class="mt-3 error" role="alert">{errorText(f.error)}</p>{/if}
	{#if f?.ok}
		{#if f.pushDevices !== undefined}
			{#if f.pushDevices > 0}
				<p class="mt-3 success" role="status">
					✓ {m.updates_push_sent({
						devices: String(f.pushDevices),
						members: String(f.pushMembers ?? 0)
					})}
				</p>
			{:else}
				<p class="mt-3 text-sm text-ink-soft" role="status">{m.updates_push_none()}</p>
			{/if}
		{:else}
			<p class="mt-3 success" role="status">
				✓ {f.importedCount !== undefined
					? m.contacts_imported_ok({ count: String(f.importedCount) })
					: m.saved()}
			</p>
		{/if}
	{/if}
{/snippet}

<h1 class="text-4xl font-black text-pine">{m.admin_title()}</h1>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<!-- draw -->
	<section class="card lg:col-span-2">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 class="text-2xl font-bold text-pine">🎲 {m.draw_title()}</h2>
				<p class="mt-1 text-ink-soft">
					{#if party.drawnAt}
						✅ {m.draw_done_at({ date: formatDateTime(party.drawnAt, getLocale(), TIMEZONE) })}
					{:else if party.drawAt}
						{m.draw_scheduled({ date: formatDateTime(party.drawAt, getLocale(), TIMEZONE) })}
					{:else}
						{m.draw_not_scheduled()}
					{/if}
				</p>
				<p class="mt-1 text-sm text-ink-soft">
					{m.draw_participants({ count: String(participants) })}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#if !party.drawnAt}
					<form method="POST" action="?/draw" use:enhance={confirmThen(m.confirm_draw())}>
						<button class="btn-primary" disabled={!!party.archivedAt}>🎲 {m.draw_now()}</button>
					</form>
				{:else}
					<form method="POST" action="?/resetDraw" use:enhance={confirmThen(m.confirm_reset())}>
						<button class="btn-danger">↺ {m.draw_reset()}</button>
					</form>
				{/if}
			</div>
		</div>
		{#if data.admin.drawError && !party.drawnAt}
			<p class="mt-3 error">⚠️ {errorText(`draw_${data.admin.drawError}`)}</p>
		{/if}
		{#if party.drawnAt}
			<p class="mt-3 text-sm text-ink-soft">🙈 {m.draw_secret_note()}</p>
		{/if}
		{@render feedback('draw')}
	</section>

	<!-- settings -->
	<section class="card">
		<h2 class="text-2xl font-bold text-pine">⚙️ {m.settings()}</h2>
		<form method="POST" action="?/settings" class="mt-4 space-y-4" use:enhance={keep}>
			<div>
				<label class="label" for="name">{m.party_name()}</label>
				<input id="name" name="name" class="input" maxlength="120" value={party.name} required />
			</div>
			<div>
				<label class="label" for="description">{m.party_description()}</label>
				<textarea id="description" name="description" rows="2" class="input" maxlength="2000"
					>{party.description}</textarea
				>
			</div>
			<div class="grid gap-4">
				<div>
					<label class="label" for="drawAt">🎲 {m.draw_when()}</label>
					<input
						id="drawAt"
						name="drawAt"
						type="datetime-local"
						class="input"
						value={toInputValue(party.drawAt, TIMEZONE)}
						disabled={!!party.drawnAt}
					/>
				</div>
				<div>
					<label class="label" for="partyAt">🎄 {m.party_when()}</label>
					<input
						id="partyAt"
						name="partyAt"
						type="datetime-local"
						class="input"
						value={toInputValue(party.partyAt, TIMEZONE)}
					/>
				</div>
			</div>
			<div>
				<label class="label" for="location">📍 {m.party_where()}</label>
				<input id="location" name="location" class="input" maxlength="300" value={party.location} />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="currency">{m.currency()}</label>
					<select id="currency" name="currency" class="input" bind:value={currency}>
						{#each CURRENCIES as c (c)}<option>{c}</option>{/each}
					</select>
				</div>
				<label class="flex items-center gap-3 self-end rounded-2xl bg-paper-2/60 p-3">
					<input
						type="checkbox"
						name="isPublic"
						class="h-5 w-5 rounded text-pine"
						checked={party.isPublic}
					/>
					<span class="text-sm font-semibold">{m.party_public()}</span>
				</label>
			</div>
			<label class="flex items-start gap-3 rounded-2xl bg-paper-2/60 p-3">
				<input
					type="checkbox"
					name="magicLinksEnabled"
					class="mt-0.5 h-5 w-5 rounded text-pine"
					checked={data.admin.magicLinksEnabled}
				/>
				<span class="text-sm">
					<span class="block font-semibold">🔗 {m.magic_links_toggle()}</span>
					<span class="mt-0.5 block text-xs text-ink-soft">{m.magic_links_help()}</span>
				</span>
			</label>
			<button class="btn-pine">{m.save()}</button>
			{@render feedback('settings')}
		</form>
	</section>

	<!-- code -->
	<section class="card">
		<h2 class="text-2xl font-bold text-pine">🔑 {m.party_code()}</h2>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<span
				class="rounded-2xl border-2 border-dashed border-gold bg-gold-2/15 px-5 py-3 font-mono text-2xl font-bold tracking-[0.2em]"
				>{data.admin.code}</span
			>
			<CopyButton text={data.admin.code} label={m.copy()} />
		</div>
		<p class="mt-2 text-sm text-ink-soft">{m.code_share_help()}</p>
		<form method="POST" action="?/code" class="mt-4 space-y-2" use:enhance={keep}>
			<input
				name="code"
				class="input font-mono tracking-widest uppercase"
				maxlength="40"
				placeholder={m.code_custom()}
				aria-label={m.code_custom()}
			/>
			<div class="flex flex-wrap gap-2">
				<button class="btn-pine">{m.save()}</button>
				<button class="btn-ghost" name="regenerate" value="1">🎲 {m.code_regenerate()}</button>
			</div>
		</form>
		<p class="mt-2 text-xs text-ink-soft">{m.code_change_note()}</p>
		{@render feedback('code')}
	</section>

	<!-- rules -->
	<section class="card lg:col-span-2">
		<h2 class="text-2xl font-bold text-pine">📜 {m.statute_title()}</h2>
		<form method="POST" action="?/rules" class="mt-4" use:enhance={keep}>
			<RuleBuilder bind:rules {currency} />
			<button class="mt-4 btn-pine">{m.save_rules()}</button>
			{@render feedback('rules')}
		</form>
	</section>

	<!-- members -->
	<section class="card lg:col-span-2">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-2xl font-bold text-pine">
				👥 {m.members_title({ count: String(data.members.length) })}
			</h2>
			{#if data.admin.magicLinksEnabled && missingLinks && data.members.length}
				<form method="POST" action="?/generateAllLinks" use:enhance={keep}>
					<button class="btn-pine btn-sm">🔗 {m.magic_link_generate_all()}</button>
				</form>
			{/if}
		</div>
		{#if data.admin.magicLinksEnabled}
			<p class="mt-2 text-xs text-ink-soft">🔒 {m.magic_link_private_note()}</p>
		{:else}
			<p class="mt-2 text-xs text-ink-soft">{m.magic_links_disabled_note()}</p>
		{/if}
		<ul class="mt-4 divide-y divide-ink/10">
			{#each data.members as member (member.id)}
				<li class="space-y-3 py-4">
					<div class="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-start">
						<div class="flex items-center gap-3">
							<Avatar {member} size={44} />
							<div class="min-w-0">
								<p class="truncate font-semibold">{fullName(member)}</p>
								<p class="flex flex-wrap gap-1.5 text-xs text-ink-soft">
									{#if member.isAdmin}<span>👑 {m.party_admin()}</span>{/if}
									{#if !member.participates}<span>{m.spectator()}</span>{/if}
									{#if !member.hasPasscode}<span class="text-berry">🔓 {m.no_passcode_short()}</span
										>{/if}
									{#if member.phone}<span class="tabular-nums">📞 {member.phone}</span>{/if}
									{#if member.locale && member.locale in LANGUAGES}
										<span>🌐 {LANGUAGES[member.locale as Locale].name}</span>
									{/if}
									{#if pushEnabledSet.has(member.id)}<span>🔔</span>{/if}
								</p>
							</div>
						</div>
						<Obscured text={member.wishlist} />
						<a
							href="/p/{party.id}/admin/members/{member.id}"
							class="btn-ghost justify-self-start btn-sm">✏️ {m.edit()}</a
						>
					</div>

					{#if data.admin.magicLinksEnabled}
						<div
							class="flex flex-col gap-2 rounded-2xl bg-paper-2/45 p-3 lg:flex-row lg:items-center lg:justify-between"
						>
							<form
								method="POST"
								action="?/setPhone"
								class="flex flex-wrap items-center gap-2 sm:flex-nowrap"
								use:enhance={keep}
							>
								<input type="hidden" name="memberId" value={member.id} />
								<input
									name="phone"
									type="tel"
									autocomplete="tel"
									class="input py-1.5 text-sm sm:w-44"
									maxlength="40"
									placeholder={m.phone_ph()}
									aria-label={m.phone_number()}
									value={member.phone}
								/>
								<select
									name="locale"
									class="input py-1.5 text-sm sm:w-36"
									value={member.locale ?? ''}
									aria-label={m.member_locale()}
								>
									<option value="">{m.member_locale_auto()}</option>
									{#each locales as loc (loc)}
										<option value={loc}>{LANGUAGES[loc].name}</option>
									{/each}
								</select>
								<button class="btn-ghost shrink-0 btn-sm">{m.save()}</button>
							</form>
							<div class="flex flex-wrap items-center gap-2">
								{#if member.magicToken}
									<CopyButton text={memberMagicUrl(member.magicToken)} label={m.copy()} />
									<a href={memberSmsHref(member)} class="btn-pine btn-sm">💬 {m.sms_send()}</a>
									<form
										method="POST"
										action="?/generateLink"
										use:enhance={confirmThen(m.confirm_regenerate_link())}
									>
										<input type="hidden" name="memberId" value={member.id} />
										<button class="btn-ghost btn-sm">🎲 {m.magic_link_regenerate()}</button>
									</form>
									<form
										method="POST"
										action="?/revokeLink"
										use:enhance={confirmThen(m.confirm_revoke_link())}
									>
										<input type="hidden" name="memberId" value={member.id} />
										<button class="btn-danger btn-sm">{m.magic_link_revoke()}</button>
									</form>
								{:else}
									<form method="POST" action="?/generateLink" use:enhance={keep}>
										<input type="hidden" name="memberId" value={member.id} />
										<button class="btn-pine btn-sm">🔗 {m.magic_link_generate()}</button>
									</form>
								{/if}
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		{#if data.admin.magicLinksEnabled}
			<ContactsImport
				members={data.members}
				drawn={!!party.drawnAt}
				magicLinksEnabled={data.admin.magicLinksEnabled}
			/>
			{@render feedback('contacts')}

			<details class="mt-4 rounded-2xl bg-paper-2/50 p-4">
				<summary class="cursor-pointer font-semibold">💬 {m.sms_template_title()}</summary>
				<p class="mt-2 text-xs text-ink-soft">
					{m.sms_template_help({ name: '{name}', party: '{party}', link: '{link}' })}
				</p>
				<form method="POST" action="?/smsTemplate" class="mt-3 space-y-3" use:enhance={keep}>
					<textarea
						name="smsTemplate"
						rows="3"
						maxlength="1000"
						class="input text-sm"
						placeholder={defaultSmsTemplate}
						aria-label={m.sms_template_title()}
						bind:value={smsTemplateDraft}
					></textarea>
					<div class="rounded-xl bg-snow/80 p-3 text-xs text-ink-soft">
						<span class="font-semibold text-ink">{m.sms_preview()}:</span>
						<p class="mt-1 break-all whitespace-pre-wrap">{smsPreviewText}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button class="btn-pine btn-sm">{m.save()}</button>
						<button
							class="btn-ghost btn-sm"
							name="reset"
							value="1"
							onclick={() => (smsTemplateDraft = '')}
						>
							{m.sms_template_reset()}
						</button>
					</div>
					{@render feedback('sms')}
				</form>
			</details>
		{/if}

		{#if !party.drawnAt}
			<details class="mt-4 rounded-2xl bg-paper-2/50 p-4">
				<summary class="cursor-pointer font-semibold">➕ {m.add_member()}</summary>
				<p class="mt-2 text-sm text-ink-soft">{m.add_member_help()}</p>
				<form method="POST" action="?/addMember" class="mt-3 grid gap-3 sm:grid-cols-2" use:enhance>
					<input
						name="firstName"
						class="input"
						placeholder={m.first_name()}
						aria-label={m.first_name()}
						maxlength="60"
					/>
					<input
						name="lastName"
						class="input"
						placeholder={m.last_name()}
						aria-label={m.last_name()}
						maxlength="60"
					/>
					<input
						name="nickname"
						class="input"
						placeholder={m.nickname()}
						aria-label={m.nickname()}
						maxlength="60"
					/>
					<input
						name="phone"
						type="tel"
						autocomplete="tel"
						class="input"
						placeholder="{m.phone_number()} ({m.optional()})"
						aria-label={m.phone_number()}
						maxlength="40"
					/>
					<select name="locale" class="input" aria-label={m.member_locale()}>
						<option value="">{m.member_locale()}: {m.member_locale_auto()}</option>
						{#each locales as loc (loc)}
							<option value={loc}>{m.member_locale()}: {LANGUAGES[loc].name}</option>
						{/each}
					</select>
					<input
						name="passcode"
						type="password"
						class="input"
						placeholder={m.passcode() + ' (' + m.optional() + ')'}
						aria-label={m.passcode()}
						autocomplete="new-password"
					/>
					{#if data.admin.magicLinksEnabled}
						<label class="flex items-center gap-2.5 text-sm sm:col-span-2">
							<input
								type="checkbox"
								name="generateLink"
								class="h-4 w-4 rounded text-pine"
								checked
							/>
							<span>{m.magic_link_auto_opt()}</span>
						</label>
					{/if}
					<button class="btn-pine sm:col-span-2 sm:justify-self-start">{m.add_member()}</button>
				</form>
			</details>
		{/if}
		{@render feedback('members')}
	</section>

	<!-- updates & reminders (push + sms) -->
	<section class="card lg:col-span-2" id="updates">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-2xl font-bold text-pine">📣 {m.updates_title()}</h2>
			<span class="chip">
				🔔 {m.updates_push_coverage({
					enabled: String(pushEnabledCount),
					total: String(data.members.length)
				})}
			</span>
		</div>
		<p class="mt-1 text-sm text-ink-soft">{m.updates_lead()}</p>

		<form method="POST" action="?/sendPush" class="mt-4 space-y-4" use:enhance={keep}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="update-audience">{m.updates_audience()}</label>
					<select id="update-audience" name="audience" class="input" bind:value={updateAudience}>
						<option value="all">{m.updates_audience_all()} ({data.members.length})</option>
						<option value="no_wishlist">
							{m.updates_audience_no_wishlist()} ({data.members.filter((x) => !x.wishlist.trim())
								.length})
						</option>
					</select>
				</div>
				<div>
					<label class="label" for="update-preset">{m.updates_preset()}</label>
					<select
						id="update-preset"
						name="preset"
						class="input"
						value={updatePreset}
						onchange={(e) => onPresetChange(e.currentTarget.value as UpdatePreset)}
					>
						<option value="wishlist_reminder">{m.updates_preset_wishlist_reminder()}</option>
						<option value="wishlist_new">{m.updates_preset_wishlist_new()}</option>
						<option value="event_reminder">{m.updates_preset_event_reminder()}</option>
						<option value="custom">{m.updates_preset_custom()}</option>
					</select>
				</div>
			</div>

			<div>
				<label class="label" for="update-message">{m.updates_message_label()}</label>
				<textarea
					id="update-message"
					rows="3"
					maxlength="500"
					class="input text-sm"
					bind:value={updateMessageDraft}
					required={updatePreset === 'custom'}
				></textarea>
				<input type="hidden" name="message" value={updateUsingPreset ? '' : updateMessageDraft} />
				<p class="mt-1 text-xs text-ink-soft">
					{m.updates_message_help({ name: '{name}', party: '{party}', link: '{link}' })}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					class="btn-pine"
					disabled={!!party.archivedAt || (updatePreset === 'custom' && !updateMessageDraft.trim())}
				>
					🔔 {m.updates_send_push()}
				</button>
				{#if updateTargetsWithPhone.length >= 2}
					<a href={groupUpdateSmsHref} class="btn-ghost">
						💬 {m.updates_sms_group({ count: String(updateTargetsWithPhone.length) })}
					</a>
				{/if}
			</div>
			{#if updateTargetsWithPhone.length >= 2 && data.admin.magicLinksEnabled}
				<p class="text-xs text-ink-soft">{m.updates_sms_group_note()}</p>
			{/if}
			{@render feedback('updates')}
		</form>

		<div class="mt-4 border-t border-ink/10 pt-3">
			{#if updateTargetsWithPhone.length}
				<p class="text-xs font-semibold text-ink-soft">{m.updates_sms_individual()}</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each updateTargetsWithPhone as mem (mem.id)}
						<a href={memberUpdateSmsHref(mem)} class="btn-ghost btn-sm">
							💬 {displayName(mem)}
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-xs text-ink-soft">{m.updates_no_phones()}</p>
			{/if}
		</div>
	</section>

	<!-- exclusions -->
	<section class="card lg:col-span-2">
		<h2 class="text-2xl font-bold text-pine">💑 {m.exclusions_admin_title()}</h2>
		<p class="mt-1 text-sm text-ink-soft">{m.exclusions_admin_help()}</p>
		<ul class="mt-4 space-y-2">
			{#each data.exclusions as ex (ex.id)}
				<li class="flex flex-wrap items-center gap-3 rounded-2xl bg-paper-2/60 p-3">
					<Avatar member={ex.a} size={32} />
					<span class="font-semibold">{displayName(ex.a)}</span>
					<span aria-hidden="true">⇄</span>
					<Avatar member={ex.b} size={32} />
					<span class="font-semibold">{displayName(ex.b)}</span>
					<span class="chip"
						>{ex.status === 'accepted'
							? '✅ ' + m.exclusion_accepted()
							: '⏳ ' + m.exclusion_pending()}</span
					>
					{#if !party.drawnAt}
						<form method="POST" action="?/removeExclusion" class="ml-auto" use:enhance={keep}>
							<input type="hidden" name="id" value={ex.id} />
							<button class="btn-ghost btn-sm">{m.remove()}</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-ink-soft">{m.exclusions_none()}</li>
			{/each}
		</ul>
		{#if !party.drawnAt && data.members.length >= 2}
			<form
				method="POST"
				action="?/addExclusion"
				class="mt-4 flex flex-col gap-2 sm:flex-row"
				use:enhance={keep}
			>
				{#each ['a', 'b'] as field (field)}
					<select name={field} class="input" required aria-label={m.exclusion_pick()}>
						<option value="">{m.exclusion_pick()}</option>
						{#each data.members as mem (mem.id)}<option value={mem.id}>{displayName(mem)}</option
							>{/each}
					</select>
				{/each}
				<button class="btn-pine shrink-0">{m.exclusion_add()}</button>
			</form>
		{/if}
		{@render feedback('exclusions')}
	</section>

	<!-- danger zone -->
	<section class="card border-berry/30 lg:col-span-2">
		<h2 class="text-2xl font-bold text-berry">🧨 {m.danger_zone()}</h2>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			{#if party.archivedAt}
				<form method="POST" action="?/unarchive" use:enhance={keep}>
					<button class="btn-pine">📤 {m.unarchive()}</button>
				</form>
			{:else}
				<form method="POST" action="?/archive" use:enhance={confirmThen(m.confirm_archive())}>
					<button class="btn-ghost">🗄️ {m.archive()}</button>
				</form>
			{/if}
			<span class="text-sm text-ink-soft">{m.archive_help()}</span>
		</div>
		<details class="mt-5">
			<summary class="cursor-pointer text-sm font-semibold text-berry">{m.delete_party()}</summary>
			<form
				method="POST"
				action="?/deleteParty"
				class="mt-3 flex flex-col gap-2 sm:flex-row"
				use:enhance={keep}
			>
				<input
					name="confirm"
					class="input"
					placeholder={m.delete_confirm_ph({ name: party.name })}
					aria-label={m.delete_party()}
				/>
				<button class="btn-danger shrink-0">{m.delete_party()}</button>
			</form>
		</details>
		{@render feedback('danger')}
	</section>
</div>

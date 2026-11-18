import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { TIMEZONE } from '$app/env/public';
import { m } from '#lib/paraglide/messages.js';
import { db, schema } from '#lib/server/db/index.ts';
import { hashSecret, isRateLimited, recordFailure } from '#lib/server/auth.ts';
import { adminMember, formString, publicMember, requireAdmin } from '#lib/server/guards.ts';
import {
	cleanCustomCode,
	generatePartyCode,
	newId,
	newMagicToken,
	normalizeCode
} from '#lib/server/ids.ts';
import {
	codeTaken,
	deleteParty,
	getExclusions,
	getMembers,
	getRules,
	replaceRules,
	resetDraw,
	runDraw,
	touchDraw
} from '#lib/server/party.ts';
import {
	activeExclusionsFor,
	createMember,
	generateMemberMagicToken,
	generateMissingMagicTokens,
	normalizeMemberLocale,
	readNames,
	revokeMemberMagicToken,
	setMemberLocale,
	setMemberPhone,
	validateNames,
	validatePasscode
} from '#lib/server/members.ts';
import { asLocale } from '#lib/server/notifications.ts';
import { notifyMembers, pushEnabledMemberIds } from '#lib/server/push.ts';
import { sanitizeRules } from '#lib/rules/catalog.ts';
import { CURRENCIES } from '#lib/currencies.ts';
import { normalizePhone } from '#lib/contacts.ts';
import { fromInputValue } from '#lib/time.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const { party } = requireAdmin(event);
	const members = getMembers(party.id);
	const byId = new Map(members.map((x) => [x.id, publicMember(x)]));
	const pushEnabledIds = pushEnabledMemberIds(members.map((x) => x.id));
	return {
		admin: {
			code: party.code,
			drawError: party.drawError,
			magicLinksEnabled: party.magicLinksEnabled,
			smsTemplate: party.smsTemplate,
			pushEnabledIds
		},
		rules: getRules(party.id),
		members: members.map(adminMember),
		exclusions: getExclusions(party.id)
			.filter((e) => e.status !== 'declined')
			.map((e) => ({
				id: e.id,
				status: e.status,
				a: byId.get(e.requesterId)!,
				b: byId.get(e.targetId)!
			}))
	};
};

const ok = (section: string, extra?: Record<string, unknown>) => ({ ok: section, ...extra });
const bad = (section: string, error: string, status = 400) => fail(status, { section, error });

function partyMember(partyId: string, memberId: string) {
	if (!memberId) return null;
	return (
		db
			.select()
			.from(schema.members)
			.where(and(eq(schema.members.id, memberId), eq(schema.members.partyId, partyId)))
			.get() ?? null
	);
}

type ContactImportEntry = {
	mode?: unknown;
	memberId?: unknown;
	firstName?: unknown;
	lastName?: unknown;
	nickname?: unknown;
	phone?: unknown;
	locale?: unknown;
	generateLink?: unknown;
};

export const actions: Actions = {
	settings: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		const name = formString(data, 'name', 120);
		if (!name) return bad('settings', 'party_name_required');
		const drawAt = fromInputValue(formString(data, 'drawAt', 16), TIMEZONE);
		if (
			!party.drawnAt &&
			drawAt &&
			drawAt <= new Date() &&
			drawAt.getTime() !== party.drawAt?.getTime()
		)
			return bad('settings', 'draw_in_past');
		const currencyRaw = formString(data, 'currency', 3).toUpperCase();
		db.update(schema.parties)
			.set({
				name,
				description: formString(data, 'description', 2000),
				location: formString(data, 'location', 300),
				partyAt: fromInputValue(formString(data, 'partyAt', 16), TIMEZONE),
				drawAt: party.drawnAt ? party.drawAt : drawAt,
				isPublic: data.get('isPublic') === 'on',
				magicLinksEnabled: data.get('magicLinksEnabled') === 'on',
				currency: CURRENCIES.includes(currencyRaw) ? currencyRaw : party.currency
			})
			.where(eq(schema.parties.id, party.id))
			.run();
		return ok('settings');
	},
	code: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		let code: string;
		if (data.get('regenerate') === '1') {
			do code = generatePartyCode();
			while (codeTaken(code));
		} else {
			const cleaned = cleanCustomCode(formString(data, 'code', 64));
			if (!cleaned) return bad('code', 'code_format');
			if (codeTaken(cleaned, party.id)) return bad('code', 'code_taken');
			code = cleaned;
		}
		db.update(schema.parties)
			.set({ code, codeNorm: normalizeCode(code) })
			.where(eq(schema.parties.id, party.id))
			.run();
		return ok('code');
	},
	rules: async (event) => {
		const { party } = requireAdmin(event);
		let rules;
		try {
			rules = sanitizeRules(
				JSON.parse(String((await event.request.formData()).get('rules') ?? '[]'))
			);
		} catch {
			return bad('rules', 'invalid');
		}
		replaceRules(party.id, rules);
		return ok('rules');
	},
	draw: (event) => {
		const { party } = requireAdmin(event);
		if (party.archivedAt) return bad('draw', 'archived');
		if (party.drawnAt) return bad('draw', 'already_drawn');
		const outcome = runDraw(party.id);
		if (outcome !== 'ok') return bad('draw', `draw_${outcome}`);
		if (!party.drawAt || party.drawAt > new Date())
			db.update(schema.parties)
				.set({ drawAt: new Date() })
				.where(eq(schema.parties.id, party.id))
				.run();
		return ok('draw');
	},
	resetDraw: (event) => {
		const { party } = requireAdmin(event);
		resetDraw(party.id);
		return ok('draw');
	},
	archive: (event) => {
		const { party } = requireAdmin(event);
		db.update(schema.parties)
			.set({ archivedAt: new Date() })
			.where(eq(schema.parties.id, party.id))
			.run();
		return ok('danger');
	},
	unarchive: (event) => {
		const { party } = requireAdmin(event);
		db.update(schema.parties)
			.set({ archivedAt: null })
			.where(eq(schema.parties.id, party.id))
			.run();
		touchDraw(party.id);
		return ok('danger');
	},
	addMember: async (event) => {
		const { party } = requireAdmin(event);
		if (party.drawnAt) return bad('members', 'locked');
		const data = await event.request.formData();
		const names = readNames(data);
		const err = validateNames(names, party.id);
		if (err) return bad('members', err);
		const pass = String(data.get('passcode') ?? '');
		const passErr = validatePasscode(pass, pass, false);
		if (passErr) return bad('members', passErr);
		const phone = formString(data, 'phone', 40);
		const locale = normalizeMemberLocale(data.get('locale'));
		const generateLink = party.magicLinksEnabled && data.get('generateLink') === 'on';
		createMember(party.id, {
			...names,
			phone,
			locale,
			passcodeHash: pass ? await hashSecret(pass) : null,
			magicToken: generateLink ? newMagicToken() : null
		});
		touchDraw(party.id);
		return ok('members');
	},
	setPhone: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		const member = partyMember(party.id, String(data.get('memberId') ?? ''));
		if (!member) return bad('members', 'not_found', 404);
		setMemberPhone(member.id, formString(data, 'phone', 40));
		if (data.has('locale')) {
			setMemberLocale(member.id, normalizeMemberLocale(data.get('locale')));
		}
		return ok('members');
	},
	setLocale: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		const member = partyMember(party.id, String(data.get('memberId') ?? ''));
		if (!member) return bad('members', 'not_found', 404);
		setMemberLocale(member.id, normalizeMemberLocale(data.get('locale')));
		return ok('members');
	},
	generateLink: async (event) => {
		const { party } = requireAdmin(event);
		if (!party.magicLinksEnabled) return bad('members', 'forbidden', 403);
		const data = await event.request.formData();
		const member = partyMember(party.id, String(data.get('memberId') ?? ''));
		if (!member) return bad('members', 'not_found', 404);
		generateMemberMagicToken(member.id);
		return ok('members');
	},
	generateAllLinks: (event) => {
		const { party } = requireAdmin(event);
		if (!party.magicLinksEnabled) return bad('members', 'forbidden', 403);
		generateMissingMagicTokens(party.id);
		return ok('members');
	},
	revokeLink: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		const member = partyMember(party.id, String(data.get('memberId') ?? ''));
		if (!member) return bad('members', 'not_found', 404);
		revokeMemberMagicToken(member.id);
		return ok('members');
	},
	smsTemplate: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		const smsTemplate = data.get('reset') === '1' ? '' : formString(data, 'smsTemplate', 1000);
		db.update(schema.parties).set({ smsTemplate }).where(eq(schema.parties.id, party.id)).run();
		return ok('sms');
	},
	sendPush: async (event) => {
		const { party } = requireAdmin(event);
		if (party.archivedAt) return bad('updates', 'archived');
		if (isRateLimited(event, 'admin-push')) return bad('updates', 'rate_limited', 429);
		recordFailure(event, 'admin-push');

		const data = await event.request.formData();
		const audience = String(data.get('audience') ?? 'all');
		const preset = String(data.get('preset') ?? 'custom');
		const customMessage = formString(data, 'message', 500);

		const isKnownPreset =
			preset === 'wishlist_reminder' || preset === 'wishlist_new' || preset === 'event_reminder';
		if (!isKnownPreset && !customMessage) return bad('updates', 'invalid');

		const allMembers = getMembers(party.id);
		const targets =
			audience === 'no_wishlist' ? allMembers.filter((mem) => !mem.wishlist.trim()) : allMembers;
		const targetIds = targets.map((mem) => mem.id);
		const memberLocaleMap = new Map(targets.map((mem) => [mem.id, mem.locale]));
		const subscribedMembers = pushEnabledMemberIds(targetIds);

		const targetUrl =
			preset === 'wishlist_reminder' ? `/p/${party.id}/me` : `/p/${party.id}`;

		const sentDevices = await notifyMembers(targetIds, (subLocale, memberId) => {
			if (customMessage) {
				return {
					title: party.name,
					body: customMessage,
					url: targetUrl,
					tag: `update-${party.id}`
				};
			}
			const loc = asLocale(memberLocaleMap.get(memberId) || subLocale);
			if (preset === 'wishlist_reminder') {
				return {
					title: m.updates_push_wishlist_reminder_title({ party: party.name }, { locale: loc }),
					body: m.updates_push_wishlist_reminder_body({}, { locale: loc }),
					url: targetUrl,
					tag: `wishlist-rem-${party.id}`
				};
			}
			if (preset === 'wishlist_new') {
				return {
					title: m.updates_push_wishlist_new_title({ party: party.name }, { locale: loc }),
					body: m.updates_push_wishlist_new_body({}, { locale: loc }),
					url: targetUrl,
					tag: `wishlist-new-${party.id}`
				};
			}
			return {
				title: m.updates_push_event_reminder_title({ party: party.name }, { locale: loc }),
				body: m.updates_push_event_reminder_body({}, { locale: loc }),
				url: targetUrl,
				tag: `event-rem-${party.id}`
			};
		});

		return ok('updates', {
			pushDevices: sentDevices,
			pushMembers: subscribedMembers.length
		});
	},
	importContacts: async (event) => {
		const { party } = requireAdmin(event);
		const data = await event.request.formData();
		let entries: ContactImportEntry[];
		try {
			const parsed = JSON.parse(String(data.get('contacts') ?? '[]'));
			if (!Array.isArray(parsed)) return bad('contacts', 'invalid');
			entries = parsed.slice(0, 200);
		} catch {
			return bad('contacts', 'invalid');
		}

		let importedCount = 0;
		let createdAny = false;

		for (const item of entries) {
			const phone = normalizePhone(String(item.phone ?? ''));
			const locale = normalizeMemberLocale(item.locale);
			const generateLink = party.magicLinksEnabled && item.generateLink === true;

			if (item.mode === 'assign') {
				const member = partyMember(party.id, String(item.memberId ?? ''));
				if (!member) continue;
				setMemberPhone(member.id, phone);
				if (locale) setMemberLocale(member.id, locale);
				if (generateLink && !member.magicToken) {
					generateMemberMagicToken(member.id, false);
				}
				importedCount++;
			} else if (item.mode === 'create') {
				if (party.drawnAt) return bad('contacts', 'locked');
				const names = {
					firstName: String(item.firstName ?? '')
						.trim()
						.slice(0, 60),
					lastName: String(item.lastName ?? '')
						.trim()
						.slice(0, 60),
					nickname: String(item.nickname ?? '')
						.trim()
						.slice(0, 60)
				};
				const nameErr = validateNames(names, party.id);
				if (nameErr) return bad('contacts', nameErr);
				createMember(party.id, {
					...names,
					phone,
					locale,
					passcodeHash: null,
					magicToken: generateLink ? newMagicToken() : null
				});
				createdAny = true;
				importedCount++;
			}
		}

		if (createdAny) touchDraw(party.id);
		return ok('contacts', { importedCount });
	},
	addExclusion: async (event) => {
		const { party } = requireAdmin(event);
		if (party.drawnAt) return bad('exclusions', 'locked');
		const data = await event.request.formData();
		const a = String(data.get('a') ?? '');
		const b = String(data.get('b') ?? '');
		const ids = new Set(getMembers(party.id).map((x) => x.id));
		if (!ids.has(a) || !ids.has(b) || a === b) return bad('exclusions', 'pick_member');
		if (activeExclusionsFor(party.id, [a, b]).length) return bad('exclusions', 'exclusion_exists');
		db.insert(schema.exclusions)
			.values({ id: newId(), partyId: party.id, requesterId: a, targetId: b, status: 'accepted' })
			.run();
		touchDraw(party.id);
		return ok('exclusions');
	},
	removeExclusion: async (event) => {
		const { party } = requireAdmin(event);
		if (party.drawnAt) return bad('exclusions', 'locked');
		const id = String((await event.request.formData()).get('id') ?? '');
		db.delete(schema.exclusions)
			.where(and(eq(schema.exclusions.id, id), eq(schema.exclusions.partyId, party.id)))
			.run();
		touchDraw(party.id);
		return ok('exclusions');
	},
	deleteParty: async (event) => {
		const { party } = requireAdmin(event);
		const confirm = formString(await event.request.formData(), 'confirm', 200);
		if (confirm !== party.name) return bad('danger', 'confirm_name');
		deleteParty(party.id);
		redirect(303, '/');
	}
};

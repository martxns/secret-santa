import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { locales } from '#lib/paraglide/runtime.js';
import {
	getSessionMember,
	hasCodeAccess,
	isSiteAdmin,
	loginMember,
	setLocaleCookie
} from './auth.ts';
import { markMemberLinkOpened } from './members.ts';
import { getMemberByMagicToken, getParty, runDraw } from './party.ts';
import type { Member, Party } from './db/schema.ts';

export type PartyContext = {
	party: Party;
	me: Member | null;
	siteAdmin: boolean;
	access: boolean;
	canAdmin: boolean;
};

/** Loads the party for `/p/[id]/…` and resolves who is looking at it. */
export function partyContext(event: RequestEvent): PartyContext {
	const id = event.params.id;
	if (!id) error(404);
	let party = getParty(id);
	if (!party) {
		if (id.length >= 20) {
			const hit = getMemberByMagicToken(id);
			if (hit && hit.party.magicLinksEnabled) {
				event.setHeaders({ 'cache-control': 'no-store' });
				loginMember(event.cookies, hit.member);
				markMemberLinkOpened(hit.member.id);
				if (hit.member.locale && (locales as readonly string[]).includes(hit.member.locale)) {
					setLocaleCookie(event.cookies, hit.member.locale);
				}
				redirect(303, `/p/${hit.party.id}`);
			}
		}
		error(404, 'not_found');
	}

	// lazy auto-draw in case the scheduler hasn't ticked yet
	if (
		party.drawAt &&
		party.drawAt <= new Date() &&
		!party.drawnAt &&
		!party.archivedAt &&
		!party.drawError
	) {
		runDraw(party.id);
		party = getParty(id)!;
	}

	const siteAdmin = isSiteAdmin(event.cookies);
	const me = getSessionMember(event.cookies, party.id);
	const access = siteAdmin || !!me || hasCodeAccess(event.cookies, party);
	return { party, me, siteAdmin, access, canAdmin: siteAdmin || !!me?.isAdmin };
}

export function requireAccess(event: RequestEvent) {
	const ctx = partyContext(event);
	if (!ctx.access) redirect(303, `/p/${ctx.party.id}`);
	return ctx;
}

export function requireMember(event: RequestEvent) {
	const ctx = requireAccess(event);
	if (!ctx.me) redirect(303, `/p/${ctx.party.id}/login`);
	return { ...ctx, me: ctx.me };
}

export function requireAdmin(event: RequestEvent) {
	const ctx = requireAccess(event);
	if (!ctx.canAdmin) redirect(303, `/p/${ctx.party.id}`);
	return ctx;
}

/** Fields safe to send to any party viewer. */
export function publicMember(m: Member) {
	return {
		id: m.id,
		firstName: m.firstName,
		lastName: m.lastName,
		nickname: m.nickname,
		avatar: m.avatar,
		isAdmin: m.isAdmin,
		participates: m.participates,
		hasPasscode: !!m.passcodeHash
	};
}
export type PublicMember = ReturnType<typeof publicMember>;

/** Fields safe only for party/site admins (includes wishlist, phone, locale, and private magic link token). */
export function adminMember(m: Member) {
	return {
		...publicMember(m),
		wishlist: m.wishlist,
		phone: m.phone,
		magicToken: m.magicToken,
		locale: m.locale,
		linkOpenedAt: m.linkOpenedAt
	};
}

/** Party fields safe for viewers with access (no code). */
export function publicParty(p: Party) {
	const { codeNorm: _n, code: _c, ...rest } = p;
	return rest;
}

export const formString = (data: FormData, key: string, max = 200) =>
	String(data.get(key) ?? '')
		.trim()
		.slice(0, max);

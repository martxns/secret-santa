import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { newId, newMagicToken } from './ids.ts';
import { revokeMemberSessions } from './auth.ts';
import { getMembers, removeAvatarFile, uploadsDir } from './party.ts';
import { displayName } from '#lib/names.ts';
import { normalizePhone } from '#lib/contacts.ts';
import { locales, type Locale } from '#lib/paraglide/runtime.js';
import { sanitizeHttpUrl, type PublicWishlistItem } from '#lib/wishlist.ts';
import { formString } from './guards.ts';

export function normalizeMemberLocale(raw: unknown): Locale | null {
	const val = String(raw ?? '').trim();
	return (locales as readonly string[]).includes(val) ? (val as Locale) : null;
}

export type NameFields = { firstName: string; lastName: string; nickname: string };

export function readNames(data: FormData): NameFields {
	return {
		firstName: formString(data, 'firstName', 60),
		lastName: formString(data, 'lastName', 60),
		nickname: formString(data, 'nickname', 60)
	};
}

/** Returns an error message key or null. */
export function validateNames(
	names: NameFields,
	partyId: string,
	exceptId?: string
): 'name_required' | 'name_taken' | null {
	if (!names.nickname && !names.firstName) return 'name_required';
	const wanted = displayName(names).toLocaleLowerCase();
	const clash = getMembers(partyId).some(
		(m) => m.id !== exceptId && displayName(m).toLocaleLowerCase() === wanted
	);
	return clash ? 'name_taken' : null;
}

/** Returns an error message key or null. */
export function validatePasscode(
	pass: string,
	repeat: string,
	required: boolean
): 'passcode_required' | 'passcode_short' | 'passcode_mismatch' | null {
	if (!pass) return required ? 'passcode_required' : null;
	if (pass.length < 4) return 'passcode_short';
	if (pass !== repeat) return 'passcode_mismatch';
	return null;
}

export function createMember(
	partyId: string,
	values: NameFields & {
		passcodeHash: string | null;
		isAdmin?: boolean;
		participates?: boolean;
		phone?: string;
		magicToken?: string | null;
		locale?: string | null;
	}
) {
	const id = newId();
	db.insert(schema.members)
		.values({
			id,
			partyId,
			firstName: values.firstName,
			lastName: values.lastName,
			nickname: values.nickname,
			passcodeHash: values.passcodeHash,
			isAdmin: values.isAdmin ?? false,
			participates: values.participates ?? true,
			phone: normalizePhone(values.phone ?? ''),
			magicToken: values.magicToken ?? null,
			locale: normalizeMemberLocale(values.locale)
		})
		.run();
	return db.select().from(schema.members).where(eq(schema.members.id, id)).get()!;
}

export function setMemberPhone(memberId: string, phone: string) {
	db.update(schema.members)
		.set({ phone: normalizePhone(phone) })
		.where(eq(schema.members.id, memberId))
		.run();
}

export function setMemberLocale(memberId: string, locale: string | null) {
	db.update(schema.members)
		.set({ locale: normalizeMemberLocale(locale) })
		.where(eq(schema.members.id, memberId))
		.run();
}

export function markMemberLinkOpened(memberId: string) {
	db.update(schema.members)
		.set({ linkOpenedAt: new Date() })
		.where(eq(schema.members.id, memberId))
		.run();
}

export function generateMemberMagicToken(memberId: string, revokeExistingSessions = true): string {
	const existing = db
		.select({ magicToken: schema.members.magicToken })
		.from(schema.members)
		.where(eq(schema.members.id, memberId))
		.get();
	const token = newMagicToken();
	db.update(schema.members)
		.set({ magicToken: token, linkOpenedAt: null })
		.where(eq(schema.members.id, memberId))
		.run();
	if (revokeExistingSessions && existing?.magicToken) {
		revokeMemberSessions(memberId);
	}
	return token;
}

export function generateMissingMagicTokens(partyId: string): number {
	const missing = db
		.select({ id: schema.members.id })
		.from(schema.members)
		.where(and(eq(schema.members.partyId, partyId), isNull(schema.members.magicToken)))
		.all();
	if (!missing.length) return 0;
	db.transaction((tx) => {
		for (const m of missing) {
			tx.update(schema.members)
				.set({ magicToken: newMagicToken() })
				.where(eq(schema.members.id, m.id))
				.run();
		}
	});
	return missing.length;
}

export function revokeMemberMagicToken(memberId: string) {
	db.update(schema.members)
		.set({ magicToken: null, linkOpenedAt: null })
		.where(eq(schema.members.id, memberId))
		.run();
	revokeMemberSessions(memberId);
}

export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** Resizes and stores an uploaded avatar. Returns error key or null. */
export async function saveAvatar(
	memberId: string,
	file: FormDataEntryValue | null
): Promise<'avatar_invalid' | 'avatar_too_big' | null> {
	if (!(file instanceof File) || file.size === 0) return 'avatar_invalid';
	if (file.size > MAX_AVATAR_BYTES) return 'avatar_too_big';
	let output: Buffer;
	try {
		output = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 50_000_000 })
			.rotate()
			.resize(320, 320, { fit: 'cover', position: 'attention' })
			.webp({ quality: 82 })
			.toBuffer();
	} catch {
		return 'avatar_invalid';
	}
	const dir = uploadsDir();
	mkdirSync(dir, { recursive: true });
	const name = `${memberId}-${newId(6)}.webp`;
	writeFileSync(join(dir, name), output);
	const old = db.select().from(schema.members).where(eq(schema.members.id, memberId)).get();
	db.update(schema.members).set({ avatar: name }).where(eq(schema.members.id, memberId)).run();
	removeAvatarFile(old?.avatar ?? null);
	return null;
}

export function clearAvatar(memberId: string) {
	const m = db.select().from(schema.members).where(eq(schema.members.id, memberId)).get();
	db.update(schema.members).set({ avatar: null }).where(eq(schema.members.id, memberId)).run();
	removeAvatarFile(m?.avatar ?? null);
}

/** Active (pending/accepted) exclusions touching any of the given members. */
export function activeExclusionsFor(partyId: string, memberIds: string[]) {
	return db
		.select()
		.from(schema.exclusions)
		.where(
			and(
				eq(schema.exclusions.partyId, partyId),
				inArray(schema.exclusions.status, ['pending', 'accepted']),
				or(
					inArray(schema.exclusions.requesterId, memberIds),
					inArray(schema.exclusions.targetId, memberIds)
				)
			)
		)
		.all();
}

function toPublicWishlistItem(row: typeof schema.wishlistItems.$inferSelect): PublicWishlistItem {
	return {
		id: row.id,
		title: row.title,
		price: row.price,
		imageUrl: row.imageUrl,
		productUrl: row.productUrl,
		store: row.store,
		note: row.note
	};
}

export function getWishlistItems(memberId: string): PublicWishlistItem[] {
	return db
		.select()
		.from(schema.wishlistItems)
		.where(eq(schema.wishlistItems.memberId, memberId))
		.orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.createdAt))
		.all()
		.map(toPublicWishlistItem);
}

export function getWishlistItemsByMemberIds(
	memberIds: string[]
): Map<string, PublicWishlistItem[]> {
	const map = new Map<string, PublicWishlistItem[]>();
	if (!memberIds.length) return map;
	const rows = db
		.select()
		.from(schema.wishlistItems)
		.where(inArray(schema.wishlistItems.memberId, memberIds))
		.orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.createdAt))
		.all();
	for (const row of rows) {
		const list = map.get(row.memberId) ?? [];
		list.push(toPublicWishlistItem(row));
		map.set(row.memberId, list);
	}
	return map;
}

export function addWishlistItem(
	memberId: string,
	party: { drawnAt: Date | null },
	input: {
		title: string;
		price?: string;
		imageUrl?: string;
		productUrl?: string;
		store?: string;
		note?: string;
	}
): PublicWishlistItem {
	const existing = getWishlistItems(memberId);
	const item = {
		id: newId(),
		memberId,
		title: input.title.trim().slice(0, 180),
		price: (input.price ?? '').trim().slice(0, 40),
		imageUrl: sanitizeHttpUrl(input.imageUrl ?? ''),
		productUrl: sanitizeHttpUrl(input.productUrl ?? ''),
		store: (input.store ?? '').trim().slice(0, 80),
		note: (input.note ?? '').trim().slice(0, 300),
		position: existing.length
	};
	db.insert(schema.wishlistItems).values(item).run();
	if (party.drawnAt) {
		db.update(schema.members)
			.set({ wishlistChangedAt: new Date() })
			.where(eq(schema.members.id, memberId))
			.run();
	}
	return toPublicWishlistItem({ ...item, createdAt: new Date() });
}

export function removeWishlistItem(
	memberId: string,
	party: { drawnAt: Date | null },
	itemId: string
): boolean {
	const deleted = db
		.delete(schema.wishlistItems)
		.where(and(eq(schema.wishlistItems.id, itemId), eq(schema.wishlistItems.memberId, memberId)))
		.run();
	if (deleted.changes > 0 && party.drawnAt) {
		db.update(schema.members)
			.set({ wishlistChangedAt: new Date() })
			.where(eq(schema.members.id, memberId))
			.run();
	}
	return deleted.changes > 0;
}

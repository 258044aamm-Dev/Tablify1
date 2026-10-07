/**
 * Stable ids — R1 step 2's gate.
 *
 * The claims under test are the ones later phases will lean on: generated ids are shaped like
 * their kind (so a wrong-kind reference is detectable), generation is deterministic **given the
 * injected source** (so tests and fixtures are reproducible), canonical bodies are exactly 26
 * characters, read acceptance is broader than canonical writing on purpose, and duplicates are
 * found in one pass with each offender reported once.
 *
 * Two fixed vectors pin the encoder itself: all-zero bytes encode to zeros, all-ones bytes to the
 * alphabet's last character. If the alphabet or the bit order ever changes, these two assertions
 * fail before any id in any fixture quietly does.
 */
import { describe, expect, it } from 'vitest';

import type { IdKind, IdSource } from '../../src/core/database/ids';
import {
	createIdFactory,
	findDuplicates,
	ID_BODY_LENGTH,
	ID_PREFIXES,
	idKindOf,
	isIdOfKind,
} from '../../src/core/database/ids';

/** mulberry32, seeded here so a failing case is reproducible from its number alone. */
function seededSource(seed: number): IdSource {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	};
	return {
		randomValues: (length) => {
			const bytes = new Uint8Array(length);
			for (let index = 0; index < length; index += 1) {
				bytes[index] = next() & 0xff;
			}
			return bytes;
		},
	};
}

/** A source with one fixed byte value, for the encoder vectors. */
function constantSource(byte: number): IdSource {
	return {
		randomValues: (length) => new Uint8Array(length).fill(byte),
	};
}

const KINDS: readonly IdKind[] = ['database', 'table', 'field', 'row', 'view', 'option'];

describe('the prefix map', () => {
	it('gives every kind its own prefix', () => {
		const prefixes = KINDS.map((kind) => ID_PREFIXES[kind]);
		expect(prefixes).toEqual(['db', 'tbl', 'fld', 'row', 'viw', 'opt']);
		expect(new Set(prefixes).size).toBe(KINDS.length);
	});
});

describe('generated ids', () => {
	it('are shaped like their own kind and no other', () => {
		const factory = createIdFactory(seededSource(1));
		for (const kind of KINDS) {
			const id = factory(kind);
			expect(isIdOfKind(kind, id)).toBe(true);
			expect(idKindOf(id)).toBe(kind);
			for (const other of KINDS) {
				if (other !== kind) {
					expect(isIdOfKind(other, id)).toBe(false);
				}
			}
		}
	});

	it('carry exactly the canonical body length', () => {
		const factory = createIdFactory(seededSource(2));
		for (const kind of KINDS) {
			const id = factory(kind);
			expect(id.length).toBe(ID_PREFIXES[kind].length + 1 + ID_BODY_LENGTH);
		}
	});

	it('encode all-zero bytes as zeros, and all-one bytes as z with a zero-padded tail character', () => {
		// 128 bits is 25 whole 5-bit characters plus three leftover bits. The leftover bits are the
		// *high* bits of the last character and the low two are zero padding — standard base32
		// (RFC 4648), and the reason the all-one vector ends `w`, not `z`: 111₂ padded is 11100₂ = 28,
		// which is the alphabet's `w`.
		expect(createIdFactory(constantSource(0))('row')).toBe(`row_${'0'.repeat(ID_BODY_LENGTH)}`);
		expect(createIdFactory(constantSource(0xff))('row')).toBe(`row_${'z'.repeat(25)}w`);
	});

	it('are deterministic for one seeded source and differ across seeds', () => {
		const first = createIdFactory(seededSource(7));
		const second = createIdFactory(seededSource(7));
		const other = createIdFactory(seededSource(8));
		const firstRun = KINDS.map((kind) => first(kind));
		const secondRun = KINDS.map((kind) => second(kind));
		const otherRun = KINDS.map((kind) => other(kind));
		expect(secondRun).toEqual(firstRun);
		expect(otherRun).not.toEqual(firstRun);
	});

	it('do not repeat over a thousand draws', () => {
		const factory = createIdFactory(seededSource(0x5eed));
		const ids: string[] = [];
		for (let index = 0; index < 1000; index += 1) {
			ids.push(factory(index % 2 === 0 ? 'row' : 'field'));
		}
		expect(findDuplicates(ids)).toEqual([]);
		expect(new Set(ids).size).toBe(1000);
	});

	it('refuse a source that returns the wrong number of bytes', () => {
		const factory = createIdFactory({ randomValues: (length) => new Uint8Array(length - 1) });
		expect(() => factory('row')).toThrow('16');
	});
});

describe('read acceptance', () => {
	it('accepts the canonical length and bodies up to sixty-four characters', () => {
		expect(isIdOfKind('table', `tbl_${'a'.repeat(ID_BODY_LENGTH)}`)).toBe(true);
		expect(isIdOfKind('table', 'tbl_a')).toBe(true);
		expect(isIdOfKind('table', `tbl_${'a'.repeat(64)}`)).toBe(true);
		expect(isIdOfKind('table', `tbl_${'a'.repeat(65)}`)).toBe(false);
	});

	it('accepts letters Crockford generation never emits, because hand edits are shaped, not canonical', () => {
		expect(isIdOfKind('option', 'opt_ilo')).toBe(true);
	});

	it('refuses empty bodies, wrong prefixes and characters outside the body set', () => {
		expect(isIdOfKind('table', 'tbl_')).toBe(false);
		expect(isIdOfKind('table', 'fld_abc')).toBe(false);
		expect(isIdOfKind('table', 'tbl_ABC')).toBe(false);
		expect(isIdOfKind('table', 'tbl_a-b')).toBe(false);
		expect(isIdOfKind('table', '_abc')).toBe(false);
		expect(idKindOf('nothing')).toBeUndefined();
	});
});

describe('duplicate detection', () => {
	it('reports nothing for an empty or unique list', () => {
		expect(findDuplicates([])).toEqual([]);
		expect(findDuplicates(['a', 'b', 'c'])).toEqual([]);
	});

	it('reports each repeated value once, in the order its repeat appears', () => {
		expect(findDuplicates(['a', 'b', 'a', 'b', 'a'])).toEqual(['a', 'b']);
		expect(findDuplicates(['x', 'x'])).toEqual(['x']);
	});
});

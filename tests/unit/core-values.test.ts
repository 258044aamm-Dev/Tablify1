/**
 * The cell-value codec — R1 step 3's gate, and the executable form of ADR-0004.
 *
 * The cases are grouped by the rule they prove, not by field type, because the rules are what the
 * rest of the phase depends on:
 *
 *   - **absent and null are the same statement** — no value — and neither is an error;
 *   - **falsy is not empty**: `false`, `0` and `""` decode as values and encode back, or the first
 *     round trip silently clears every unchecked box and every zero;
 *   - **a value the field cannot represent is preserved raw** with a reason, never repaired;
 *   - **units are pinned**: percent points, whole seconds, offset-carrying instants, `YYYY-MM-DD`
 *     calendar dates with no timezone anywhere on the path;
 *   - **encode is a verdict**, not a best effort: write, omit, or unwritable with a reason.
 */
import { describe, expect, it } from 'vitest';

import type {
	CanonicalCell,
	CellDecode,
	DocumentFieldTypeId,
	InvalidCell,
	JsonValue,
} from '../../src/core/database/index';
import { decodeCell, encodeCell, isInvalidCell } from '../../src/core/database/index';

/** Every field type a document can declare — the loop in the first block walks all of them. */
const TYPES: readonly DocumentFieldTypeId[] = [
	'text',
	'longText',
	'url',
	'email',
	'phone',
	'number',
	'currency',
	'percent',
	'duration',
	'rating',
	'checkbox',
	'date',
	'datetime',
	'singleSelect',
	'multiSelect',
	'attachment',
	'link',
	'createdTime',
	'lastModifiedTime',
];

/** Decode something the test expects to be a value, and hand back the canonical cell. */
function valueOf(type: DocumentFieldTypeId, raw: JsonValue | undefined): CanonicalCell {
	const decoded = decodeCell(type, raw);
	if (decoded.kind !== 'value') {
		throw new Error(`expected ${type} to accept the value; it said ${decoded.value.reason}`);
	}
	return decoded.value;
}

/** Decode something the test expects to be refused, and hand back the invalid cell. */
function invalidOf(type: DocumentFieldTypeId, raw: JsonValue | undefined): InvalidCell {
	const decoded = decodeCell(type, raw);
	if (decoded.kind !== 'invalid') {
		throw new Error(`expected ${type} to refuse the value; it accepted it`);
	}
	return decoded.value;
}

describe('absent and null', () => {
	it('are the same statement for every field type', () => {
		for (const type of TYPES) {
			expect(valueOf(type, undefined)).toBeNull();
			expect(valueOf(type, null)).toBeNull();
		}
	});
});

describe('falsy values are values', () => {
	it('keeps false on a checkbox', () => {
		expect(valueOf('checkbox', false)).toBe(false);
		const encoded = encodeCell('checkbox', false);
		expect(encoded).toEqual({ kind: 'write', json: false });
	});

	it('keeps zero on numbers, percent, currency, duration and rating', () => {
		for (const type of ['number', 'percent', 'currency', 'duration', 'rating'] as const) {
			expect(valueOf(type, 0)).toBe(0);
			expect(encodeCell(type, 0)).toEqual({ kind: 'write', json: 0 });
		}
	});

	it('keeps an empty string on text-like fields', () => {
		for (const type of ['text', 'longText', 'url', 'email', 'phone'] as const) {
			expect(valueOf(type, '')).toBe('');
			expect(encodeCell(type, '')).toEqual({ kind: 'write', json: '' });
		}
	});
});

describe('text-like fields', () => {
	it('accept any string, however little it looks like the type', () => {
		// The url/email/phone checks are validators that warn in the editor; a note is a user's data
		// and a parser that refuses what it cannot recognise is a parser that loses data.
		expect(valueOf('url', 'not a url')).toBe('not a url');
		expect(valueOf('email', 'nope')).toBe('nope');
		expect(valueOf('phone', '?')).toBe('?');
	});

	it('refuse non-strings with the raw value kept', () => {
		const refused = invalidOf('text', 5);
		expect(refused.reason).toBe('not a string');
		expect(refused.raw).toBe(5);
	});
});

describe('numbers and their units', () => {
	it('reads percent as percent points', () => {
		expect(valueOf('percent', 25)).toBe(25);
	});

	it('reads duration as seconds, whole or fractional', () => {
		// The guide's value table says *finite number*, and the legacy `duration` parser keeps
		// fractional seconds as written; refusing 1.5 here would be stricter than the contract.
		expect(valueOf('duration', 90)).toBe(90);
		expect(valueOf('duration', 1.5)).toBe(1.5);
		expect(invalidOf('duration', -1).reason).toContain('non-negative');
	});

	it('reads rating as non-negative points, half stars included', () => {
		expect(valueOf('rating', 5)).toBe(5);
		expect(valueOf('rating', 2.5)).toBe(2.5);
		expect(invalidOf('rating', -1).reason).toContain('non-negative');
	});

	it('refuses non-numbers', () => {
		expect(invalidOf('number', '25').reason).toBe('not a finite number');
		expect(invalidOf('currency', true).reason).toBe('not a finite number');
	});
});

describe('dates and instants', () => {
	it('accepts a real calendar date and keeps its spelling', () => {
		expect(valueOf('date', '2025-09-24')).toBe('2025-09-24');
	});

	it('refuses a date that does not exist, a datetime, and a number', () => {
		expect(invalidOf('date', '2025-02-30').reason).toBe('not a calendar date');
		expect(invalidOf('date', '2025-09-24T00:00:00Z').reason).toBe('not a calendar date');
		expect(invalidOf('date', 20250924).reason).toBe('not a calendar date');
	});

	it('accepts an instant with its own offset, spelled exactly as written', () => {
		expect(valueOf('datetime', '2025-09-24T10:00:00Z')).toBe('2025-09-24T10:00:00Z');
		expect(valueOf('datetime', '2025-09-24T10:00:00+06:00')).toBe('2025-09-24T10:00:00+06:00');
	});

	it('refuses an instant without an offset, because who reads it changes what it means', () => {
		const refused = invalidOf('datetime', '2025-09-24T10:00:00');
		expect(refused.reason).toBe('an instant without an offset');
		expect(invalidOf('datetime', 'yesterday').reason).toBe('not an instant');
	});
});

describe('select fields', () => {
	it('accepts option ids, including ids this field may not own yet', () => {
		expect(valueOf('singleSelect', 'opt_abc123')).toBe('opt_abc123');
	});

	it('refuses labels and other id kinds', () => {
		expect(invalidOf('singleSelect', 'Blue').reason).toBe('not an option id');
		expect(invalidOf('singleSelect', 'row_abc123').reason).toBe('not an option id');
	});

	it('keeps the order of a multi-select and refuses duplicates or wrong elements', () => {
		expect(valueOf('multiSelect', ['opt_b', 'opt_a'])).toEqual(['opt_b', 'opt_a']);
		expect(invalidOf('multiSelect', ['opt_a', 'opt_a']).reason).toBe(
			'the same option id twice',
		);
		expect(invalidOf('multiSelect', ['Blue']).reason).toBe('not a list of option ids');
		expect(invalidOf('multiSelect', 'opt_a').reason).toBe('not a list of option ids');
	});

	it('reads an empty list as no value', () => {
		expect(valueOf('multiSelect', [])).toBeNull();
	});
});

describe('attachments', () => {
	it('accepts ordered vault-relative paths, including spaces, unicode and emoji', () => {
		const paths = ['Attachments/report final.pdf', 'Bilder/übersicht 🙂.png'];
		expect(valueOf('attachment', paths)).toEqual(paths);
	});

	it('refuses absolute paths, drive letters and paths that climb out of the vault', () => {
		expect(invalidOf('attachment', ['/etc/passwd']).reason).toContain('absolute');
		expect(invalidOf('attachment', ['C:/Windows/x.png']).reason).toContain('drive');
		expect(invalidOf('attachment', ['../outside.png']).reason).toContain('climbs out');
		expect(invalidOf('attachment', ['']).reason).toContain('empty');
	});

	it('reads an empty list as no value and a non-list as invalid', () => {
		expect(valueOf('attachment', [])).toBeNull();
		expect(invalidOf('attachment', 'a.png').reason).toBe('not a list of attachment paths');
	});
});

describe('links', () => {
	it('accepts a row id or an ordered list of them', () => {
		expect(valueOf('link', 'row_abc123')).toBe('row_abc123');
		expect(valueOf('link', ['row_b', 'row_a'])).toEqual(['row_b', 'row_a']);
	});

	it('refuses other id kinds, duplicates and non-lists', () => {
		expect(invalidOf('link', 'fld_abc123').reason).toBe('not a row id');
		expect(invalidOf('link', ['row_a', 'row_a']).reason).toBe('the same row id twice');
		expect(invalidOf('link', ['opt_a']).reason).toBe('not a list of row ids');
		expect(invalidOf('link', 5).reason).toBe('not a list of row ids');
	});

	it('reads an empty list as no value', () => {
		expect(valueOf('link', [])).toBeNull();
	});
});

describe('the read-only time columns', () => {
	it('never accept a stored value, and keep whatever the file had', () => {
		for (const type of ['createdTime', 'lastModifiedTime'] as const) {
			const refused = invalidOf(type, '2025-01-01T00:00:00Z');
			expect(refused.reason).toContain('read-only');
			expect(refused.raw).toBe('2025-01-01T00:00:00Z');
			expect(encodeCell(type, '2025-01-01T00:00:00Z')).toEqual({
				kind: 'unwritable',
				reason: 'row timestamp fields are never written as cells',
			});
			// A preserved invalid value still writes its raw JSON back, whatever the type.
			const preserved = invalidOf(type, 'anything');
			expect(
				encodeCell(type, { invalid: true, raw: preserved.raw, reason: preserved.reason }),
			).toEqual({ kind: 'write', json: 'anything' });
		}
	});
});

describe('invalid values are preserved, not repaired', () => {
	it('keeps the raw JSON exactly, down to nested objects and empty arrays', () => {
		const nested = { a: [1, { b: null }] };
		const refused = invalidOf('text', nested);
		expect(refused.raw).toEqual(nested);
		expect(refused.reason.length).toBeGreaterThan(0);
	});

	it('writes the raw JSON back for any field type', () => {
		for (const type of TYPES) {
			const candidate = { weird: [1, 2] };
			const encoded = encodeCell(type, { invalid: true, raw: candidate, reason: 'test' });
			expect(encoded).toEqual({ kind: 'write', json: candidate });
		}
	});

	it('is distinguishable from a list and from null', () => {
		expect(isInvalidCell(['row_a'])).toBe(false);
		expect(isInvalidCell(null)).toBe(false);
		expect(isInvalidCell('row_a')).toBe(false);
		expect(isInvalidCell({ invalid: true, raw: 1, reason: 'x' })).toBe(true);
	});
});

describe('encoding', () => {
	it('omits the key for no value, for every type', () => {
		for (const type of TYPES) {
			expect(encodeCell(type, null)).toEqual({ kind: 'omit' });
		}
	});

	it('reports an unwritable value instead of dropping it', () => {
		expect(encodeCell('text', 5)).toEqual({
			kind: 'unwritable',
			reason: 'not a string',
		});
		expect(encodeCell('multiSelect', 'opt_a')).toEqual({
			kind: 'unwritable',
			reason: 'not a list of option ids',
		});
		expect(encodeCell('date', '2025-02-30').kind).toBe('unwritable');
	});
});

describe('decode → encode → decode', () => {
	/** One accepted value per type, chosen to exercise every branch of the codec's shape rules. */
	const SAMPLES: readonly (readonly [DocumentFieldTypeId, JsonValue | undefined])[] = [
		['text', 'plain'],
		['longText', 'two\nlines'],
		['url', 'https://example.com/a?b=1'],
		['email', 'a@b.co'],
		['phone', '+31 6 1234 5678'],
		['number', -12.5],
		['currency', 1234.56],
		['percent', 25],
		['duration', 5400],
		['rating', 4],
		['checkbox', false],
		['date', '2025-12-31'],
		['datetime', '2025-12-31T23:59:59+01:00'],
		['singleSelect', 'opt_zzz'],
		['multiSelect', ['opt_b', 'opt_a']],
		['attachment', ['dir with space/ü.odt']],
		['link', 'row_zzz'],
		['link', ['row_b', 'row_a']],
	];

	it('is the identity on every sample', () => {
		for (const [type, raw] of SAMPLES) {
			const first = decodeCell(type, raw);
			expect(first.kind).toBe('value');
			if (first.kind !== 'value') {
				continue;
			}
			const encoded = encodeCell(type, first.value);
			expect(encoded.kind).toBe('write');
			if (encoded.kind !== 'write') {
				continue;
			}
			const second: CellDecode = decodeCell(type, encoded.json);
			expect(second.kind).toBe('value');
			if (second.kind === 'value') {
				expect(second.value).toEqual(first.value);
			}
		}
	});
});

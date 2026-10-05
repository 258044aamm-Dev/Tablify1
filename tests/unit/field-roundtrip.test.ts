/**
 * The round-trip table: one entry per type, covering the shapes a real vault contains.
 *
 * What it proves, for every case in the table: `parse` → `toYaml` → `parse` is stable, and the YAML form is
 * stable too (a second cycle writes byte-identical frontmatter, which is what keeps a no-op edit from
 * touching a note). It then renders both display forms and asserts the two things a cell must never show:
 * `undefined`, `NaN` or `[object Object]`.
 *
 * The cases are chosen from what actually arrives, not from what would be convenient:
 *
 *   - **empty** — `null`, `undefined`, and the empty string, which are three spellings of "no value";
 *   - **smallest and largest plausible** — including `0001-01-01` and `9999-12-31`, because a range that
 *     only works in the middle is a range that fails quietly at the edges;
 *   - **surrounding whitespace** — `text` and `longText` keep it (frontmatter is authored), everything else
 *     trims it (a pasted cell is machine text);
 *   - **unicode** — emoji with a ZWJ sequence, right-to-left text, combining marks;
 *   - **hostile** — an object where a scalar belongs;
 *   - **the locale cases** — the same values in a Bengali vault, and in a vault whose locale tag is broken,
 *     because "no `Intl` call without a documented fallback" has to mean something executable.
 */
import { describe, expect, it } from 'vitest';
import type { FieldContext, FieldTypeId } from '../../src/core/types';
import { getField } from '../../src/core/fieldTypes';
import { localeProblemFor as dateLocaleProblem } from '../../src/core/format/iso';
import { localeProblemFor as numberLocaleProblem } from '../../src/core/format/numbers';
import { makeContext } from './field-contract.suite';

/** One row of the table: a label for the report and the raw input a user or a file could produce. */
type RoundTripCase = {
	readonly label: string;
	readonly raw: unknown;
};

type RoundTripTable = {
	readonly id: FieldTypeId;
	readonly ctx: FieldContext;
	readonly cases: readonly RoundTripCase[];
};

const base = makeContext();
const currencyCtx = makeContext({ fieldOptions: { symbol: '$', precision: 2 } });
const ratingCtx = makeContext({ fieldOptions: { max: 5 } });
const selectCtx = makeContext({
	fieldOptions: {
		options: [
			{ id: 'o1', name: 'Todo' },
			{ id: 'o2', name: 'Doing' },
		],
	},
});
const multiSelectCtx = makeContext({
	fieldOptions: {
		options: [
			{ id: 'o1', name: 'Draft' },
			{ id: 'o2', name: 'Research' },
		],
	},
});

/** The three spellings of "no value", plus a hostile shape, in every table. */
const emptyAndHostile = (extra: readonly RoundTripCase[] = []): readonly RoundTripCase[] => [
	{ label: 'empty (null)', raw: null },
	{ label: 'empty (undefined)', raw: undefined },
	{ label: 'empty (empty string)', raw: '' },
	...extra,
	{ label: 'hostile (an object)', raw: { nested: { deep: true } } },
	{ label: 'hostile (a function)', raw: () => 'no' },
];

const tables: readonly RoundTripTable[] = [
	{
		id: 'text',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (one character)', raw: 'a' },
			{ label: 'largest (5,000 characters)', raw: 'x'.repeat(5000) },
			{ label: 'surrounding whitespace is preserved', raw: '  padded  ' },
			{ label: 'whitespace only is the empty value', raw: '   ' },
			{ label: 'unicode (a ZWJ emoji sequence)', raw: '👩‍👩‍👧‍👦' },
			{ label: 'unicode (right to left)', raw: 'مرحبا' },
			{ label: 'unicode (a combining mark)', raw: 'e\u0301' },
		]),
	},
	{
		id: 'longText',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (one character)', raw: 'a' },
			{ label: 'largest (5,000 characters)', raw: 'x'.repeat(5000) },
			{ label: 'surrounding whitespace is preserved', raw: '  padded  ' },
			{ label: 'two lines', raw: 'line one\nline two' },
			{ label: 'a block scalar with CRLF input', raw: 'a\r\nb' },
			{ label: 'unicode mixed with newlines', raw: '🎉 party\nمرحبا' },
		]),
	},
	{
		id: 'number',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (zero)', raw: 0 },
			{ label: 'largest plausible', raw: 1e15 },
			{ label: 'smallest negative', raw: -1e15 },
			{ label: 'a fractional value', raw: 1234.5 },
			{ label: 'surrounding whitespace', raw: '  12  ' },
			{ label: 'the grouped form a cell displays', raw: '1,234.5' },
			{ label: 'a negative in parentheses-free form', raw: '-3.5' },
		]),
	},
	{
		id: 'currency',
		ctx: currencyCtx,
		cases: emptyAndHostile([
			{ label: 'smallest (zero)', raw: 0 },
			{ label: 'largest plausible', raw: 999999999.99 },
			{ label: 'a negative amount', raw: -3.5 },
			{ label: 'the displayed form with a symbol', raw: '  $1,234.50 ' },
			{ label: 'a symbol before the sign', raw: '-$3.50' },
		]),
	},
	{
		id: 'percent',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (zero)', raw: 0 },
			{ label: 'largest plausible', raw: 1e6 },
			{ label: 'a negative percentage', raw: -4 },
			{ label: 'the displayed form with a sign', raw: ' 25% ' },
			{ label: 'a fraction of a percent', raw: 12.5 },
		]),
	},
	{
		id: 'checkbox',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (false)', raw: false },
			{ label: 'largest (true)', raw: true },
			{ label: 'surrounding whitespace', raw: ' true ' },
			{ label: 'the word a person types (yes)', raw: 'yes' },
			{ label: 'the word a person types (no)', raw: 'no' },
			{ label: 'the digits a spreadsheet writes (1)', raw: 1 },
			{ label: 'the digits a spreadsheet writes (0)', raw: '0' },
			{ label: 'a checkmark', raw: '✓' },
		]),
	},
	{
		id: 'date',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest plausible (0001-01-01)', raw: '0001-01-01' },
			{ label: 'largest plausible (9999-12-31)', raw: '9999-12-31' },
			{ label: 'a leap day', raw: '2024-02-29' },
			{ label: 'surrounding whitespace', raw: ' 2026-10-05 ' },
			{ label: 'slashes instead of dashes', raw: '2026/10/05' },
			{ label: 'the date part of an instant, as written', raw: '2026-10-05T09:30:00Z' },
			{ label: 'the locale rendering a cell shows', raw: '5 Oct 2026' },
		]),
	},
	{
		id: 'datetime',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest plausible (0001-01-01T00:00:00Z)', raw: '0001-01-01T00:00:00Z' },
			{ label: 'largest plausible (9999-12-31T23:59:59Z)', raw: '9999-12-31T23:59:59Z' },
			{ label: 'an instant with milliseconds', raw: '2026-10-05T09:30:00.500Z' },
			{ label: 'another offset for the same moment', raw: '2026-10-05T15:30:00+06:00' },
			{ label: 'surrounding whitespace', raw: ' 2026-10-05T09:30:00Z ' },
			{ label: 'a wall-clock reading', raw: '2026-10-05 09:30' },
			{ label: 'the locale rendering a cell shows', raw: '5 Oct 2026, 09:30' },
			{ label: 'a number of epoch milliseconds', raw: 1_758_695_200_000 },
		]),
	},
	{
		id: 'url',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (a bare host)', raw: 'https://example.com' },
			{
				label: 'largest (a long query and fragment)',
				raw: 'https://example.com/docs?q=1#top',
			},
			{ label: 'surrounding whitespace', raw: '  https://example.com  ' },
			{ label: 'a link without a scheme', raw: 'www.example.com' },
			{ label: 'text that is not a link at all', raw: ' not a link at all ' },
			{ label: 'unicode in the path', raw: 'https://example.com/道路' },
		]),
	},
	{
		id: 'email',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest plausible', raw: 'a@b.co' },
			{ label: 'an ordinary address', raw: 'sam@example.com' },
			{ label: 'upper case, preserved as written', raw: 'SAM@EXAMPLE.COM' },
			{ label: 'surrounding whitespace', raw: '  sam@example.com  ' },
			{ label: 'text that is not an address', raw: ' not-an-address ' },
		]),
	},
	{
		id: 'phone',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest plausible', raw: '4155550132' },
			{ label: 'an internationally written number', raw: '+1 (415) 555-0132' },
			{ label: 'surrounding whitespace', raw: '  415.555.0132  ' },
			{ label: 'too few digits to be a number', raw: '12345' },
		]),
	},
	{
		id: 'singleSelect',
		ctx: selectCtx,
		cases: emptyAndHostile([
			{ label: 'smallest (one option)', raw: 'Todo' },
			{ label: 'an option written in another case', raw: ' doing ' },
			{ label: 'a label the option list does not know', raw: 'Someday' },
			{ label: 'unicode in a label', raw: '道路' },
		]),
	},
	{
		id: 'multiSelect',
		ctx: multiSelectCtx,
		cases: emptyAndHostile([
			{ label: 'smallest (one label)', raw: 'Draft' },
			{ label: 'the clipboard form of two labels', raw: 'Draft, Research' },
			{ label: 'a list with an unknown label', raw: 'Draft, Drama' },
			{ label: 'the same label twice, in two cases', raw: 'Draft, draft' },
			{ label: 'a label containing a comma', raw: 'Berlin, Mitte' },
			{ label: 'a list already in YAML shape', raw: ['Draft', 'Research'] },
		]),
	},
	{
		id: 'rating',
		ctx: ratingCtx,
		cases: emptyAndHostile([
			{ label: 'smallest (zero stars)', raw: 0 },
			{ label: 'largest (five stars)', raw: 5 },
			{ label: 'half a star', raw: 4.5 },
			{ label: 'a fraction the glyphs cannot say', raw: 4.3 },
			{ label: 'the star form a cell displays', raw: ' ★★★★⯨ ' },
			{ label: 'the fraction-and-total form a person types', raw: '4.3/5' },
			{ label: 'above the column maximum, clamped with a warning', raw: 7 },
		]),
	},
	{
		id: 'duration',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (zero)', raw: 0 },
			{ label: 'largest plausible (99:59:59)', raw: 359999 },
			{ label: 'the form a person writes (45m)', raw: '45m' },
			{ label: 'the clock form (1:30)', raw: '1:30' },
			{ label: 'the clock form with seconds (0:01:30)', raw: '0:01:30' },
			{ label: 'a bare number in the column unit', raw: '90' },
			{ label: 'two units together (1h30m)', raw: '1h30m' },
			{ label: 'a fractional hour', raw: '1.5h' },
			{ label: 'surrounding whitespace', raw: ' 45m ' },
		]),
	},
	{
		id: 'attachment',
		ctx: base,
		cases: emptyAndHostile([
			{ label: 'smallest (one path)', raw: 'Assets/wireframe.png' },
			{ label: 'a wikilink from the old build', raw: '[[Assets/wireframe.png]]' },
			{ label: 'a wikilink with a label', raw: '[[Assets/wireframe.png|the wireframe]]' },
			{ label: 'a markdown link', raw: '[plan](Assets/plan.pdf)' },
			{ label: 'two paths, comma separated', raw: 'Assets/a.png, Assets/b.pdf' },
			{ label: 'a file name with spaces and parentheses', raw: ['Assets/plan (1).pdf'] },
			{ label: 'a file name with a comma, quoted', raw: 'Assets/a.png, "Assets/b, c.pdf"' },
		]),
	},
];

/** Counted for the summary line the step's acceptance asks for. */
const results: { id: FieldTypeId; label: string; outcome: 'round-trip' | 'refused' }[] = [];
let exceptions = 0;

describe('every type round-trips through frontmatter', () => {
	for (const table of tables) {
		const field = getField(table.id);
		describe(`${table.id}`, () => {
			for (const testCase of table.cases) {
				it(`${testCase.label}`, () => {
					expect(field, `${table.id} is not registered`).toBeDefined();
					if (field === undefined) {
						return;
					}
					let first: ReturnType<typeof field.parse> | undefined;
					expect(() => {
						first = field.parse(testCase.raw, table.ctx);
					}, 'parse threw').not.toThrow();
					if (first === undefined) {
						exceptions += 1;
						results.push({ id: table.id, label: testCase.label, outcome: 'refused' });
						throw new Error(
							`${table.id}: parse returned nothing for ${testCase.label}`,
						);
					}
					if (!first.ok) {
						results.push({ id: table.id, label: testCase.label, outcome: 'refused' });
						// A hostile input must be refused *with a reason*, never silently emptied or thrown.
						expect(
							first.error.length,
							`${table.id}: the refusal needs a reason`,
						).toBeGreaterThan(0);
						expect(first.raw, `${table.id}: the refusal must carry its input`).toBe(
							testCase.raw,
						);
						return;
					}

					results.push({ id: table.id, label: testCase.label, outcome: 'round-trip' });
					const value = first.value;
					const yaml = field.toYaml(value, table.ctx);
					const second = field.parse(yaml, table.ctx);
					expect(
						second.ok,
						`${table.id}: parse(toYaml(parse(${testCase.label}))) failed`,
					).toBe(true);
					if (second.ok) {
						expect(
							second.value,
							`${table.id}: the round-trip changed ${testCase.label}`,
						).toEqual(value);
						expect(
							field.toYaml(second.value, table.ctx),
							`${table.id}: YAML is not stable`,
						).toEqual(yaml);
					}

					const display = field.formatDisplay(value, table.ctx);
					const plain = field.formatPlain(value, table.ctx);
					for (const [name, text] of [
						['formatDisplay', display],
						['formatPlain', plain],
					] as const) {
						expect(typeof text, `${table.id}: ${name} must be a string`).toBe('string');
						for (const forbidden of ['undefined', 'NaN', '[object Object]']) {
							expect(text, `${table.id}: ${name} leaked ${forbidden}`).not.toContain(
								forbidden,
							);
						}
					}

					// The plain form is a **fixpoint**, not an equality: `parse` and `parsePlain` have different
					// whitespace policies on purpose (frontmatter is authored text and is preserved; a pasted
					// cell is machine text and is trimmed and NFC-normalised), so a value carrying padding or a
					// decomposed accent changes once, on the first paste-shaped cycle, and never again.
					const fromPlain = field.parsePlain(plain, table.ctx);
					expect(fromPlain.ok, `${table.id}: parsePlain(formatPlain(...)) failed`).toBe(
						true,
					);
					if (fromPlain.ok) {
						const plainOnce = field.formatPlain(fromPlain.value, table.ctx);
						const twice = field.parsePlain(plainOnce, table.ctx);
						expect(twice.ok, `${table.id}: the second plain cycle failed`).toBe(true);
						if (twice.ok) {
							expect(twice.value, `${table.id}: the plain cycle drifted`).toEqual(
								fromPlain.value,
							);
							expect(
								field.formatPlain(twice.value, table.ctx),
								`${table.id}: the plain text drifted`,
							).toBe(plainOnce);
						}
						// A value that is already in plain form must survive the cycle untouched; one that is not
						// (padded, decomposed) is normalised once, which is the documented policy. "Already in
						// plain form" is a fact about the value, not about the text: it is exactly the case where
						// `parsePlain` returns what it was given.
						if (typeof value === 'string') {
							const direct = field.parsePlain(value, table.ctx);
							if (direct.ok && direct.value === value) {
								expect(
									fromPlain.value,
									`${table.id}: an already-plain value was changed`,
								).toEqual(value);
							}
						}
					}
				});
			}
		});
	}

	const plannedCases = tables.reduce((total, table) => total + table.cases.length, 0);

	// The planned totals are in this test's name, so the runner's own output carries the size of the table it
	// proved, and the split is asserted rather than printed (this repo forbids console output everywhere,
	// plugin and tests alike, and `noInlineConfig` means the rule is not waivable). The summary line in the
	// step report is produced by the same numbers through the JSON reporter.
	it(`covers all ${String(plannedCases)} cases across ${String(tables.length)} types`, () => {
		const roundTrips = results.filter((result) => result.outcome === 'round-trip').length;
		const refused = results.filter((result) => result.outcome === 'refused').length;
		expect(exceptions).toBe(0);
		expect(roundTrips + refused).toBe(plannedCases);
		expect(results).toHaveLength(
			tables.reduce((total, table) => total + table.cases.length, 0),
		);
	});
});

describe('the documented divergences', () => {
	it('percent stores the number a person reads: 25 is 25 %, not 0.25', () => {
		const percent = getField('percent');
		expect(percent).toBeDefined();
		if (percent === undefined) {
			return;
		}
		// The upstream schema stores 0.25 for 25 % and multiplies by 100 to render. This plugin stores 25, so
		// the note says `progress: 25` — readable by a person, and re-scaled only by the sync mapper.
		expect(percent.parse(25, base)).toEqual({ ok: true, value: 25 });
		expect(percent.parse(0.25, base)).toEqual({ ok: true, value: 0.25 });
		expect(percent.formatDisplay(25, base)).toBe('25%');
	});

	it('duration reads an explicit unit before the column unit (the AUDIT §8 probe)', () => {
		const duration = getField('duration');
		expect(duration).toBeDefined();
		if (duration === undefined) {
			return;
		}
		// The old build read `45m` as 45 seconds: an unanchored clock regex matched a prefix, and a bare
		// number was read in the field's unit before explicit units were considered.
		const probe: readonly (readonly [string, number])[] = [
			['90', 90],
			['45m', 2700],
			['2h', 7200],
			['1h30m', 5400],
		];
		for (const [written, seconds] of probe) {
			expect(
				duration.parse(written, base),
				`"${written}" must be ${String(seconds)} seconds`,
			).toEqual({
				ok: true,
				value: seconds,
			});
		}
	});

	it('answers "45m" the same way in a filter, so matching and storing agree', () => {
		const duration = getField('duration');
		expect(duration).toBeDefined();
		if (duration === undefined) {
			return;
		}
		expect(duration.matches(2700, 'is', '45m', base)).toBe(true);
		expect(duration.matches(45, 'is', '45m', base)).toBe(false);
	});
});

describe('documented refusals carry a reason', () => {
	const refusals: readonly {
		readonly id: FieldTypeId;
		readonly ctx: FieldContext;
		readonly raw: unknown;
		readonly matches: RegExp;
	}[] = [
		{
			id: 'number',
			ctx: base,
			raw: '1,5',
			// Ambiguous by design: a comma is a group separator here, and `1,5` is not a grouping.
			matches: /decimal separator/,
		},
		{
			id: 'currency',
			ctx: currencyCtx,
			raw: '12 usd',
			matches: /number, optionally with a currency symbol/,
		},
		{ id: 'currency', ctx: currencyCtx, raw: '50%', matches: /not a percentage/ },
		{ id: 'percent', ctx: base, raw: 'half', matches: /not a number/ },
		{ id: 'checkbox', ctx: base, raw: 2, matches: /true or false/ },
		{ id: 'date', ctx: base, raw: '2024-02-30', matches: /does not exist|date is expected/ },
		{ id: 'date', ctx: base, raw: '05.10.2026', matches: /date is expected/ },
		{
			id: 'datetime',
			ctx: base,
			raw: '2026-13-01T00:00:00Z',
			matches: /not a valid ISO 8601 instant/,
		},
		{ id: 'duration', ctx: base, raw: '1h 30', matches: /every number needs a unit/ },
		{ id: 'duration', ctx: base, raw: '45 minutes', matches: /every number needs a unit/ },
		{ id: 'duration', ctx: base, raw: '-5m', matches: /cannot be negative/ },
		{ id: 'rating', ctx: ratingCtx, raw: 'not a rating', matches: /not a number/ },
	];

	for (const refusal of refusals) {
		it(`${refusal.id} refuses ${JSON.stringify(refusal.raw)} with a reason`, () => {
			const field = getField(refusal.id);
			expect(field).toBeDefined();
			if (field === undefined) {
				return;
			}
			const parsed = field.parse(refusal.raw, refusal.ctx);
			expect(parsed.ok).toBe(false);
			if (!parsed.ok) {
				expect(parsed.error).toMatch(refusal.matches);
			}
		});
	}
});

describe('a vault with an unusual locale', () => {
	const bengali = makeContext({ locale: 'bn-BD' });

	it('renders and reads back numbers in the locale’s own numerals', () => {
		const number = getField('number');
		expect(number).toBeDefined();
		if (number === undefined) {
			return;
		}
		const shown = number.formatDisplay(1234.5, bengali);
		expect(shown).not.toBe('1234.5');
		expect(number.parse(shown, bengali)).toEqual({ ok: true, value: 1234.5 });
	});

	it('renders and reads back a date with a Bengali month name and digits', () => {
		const date = getField('date');
		expect(date).toBeDefined();
		if (date === undefined) {
			return;
		}
		const shown = date.formatDisplay('2001-11-22', bengali);
		expect(date.parse(shown, bengali)).toEqual({ ok: true, value: '2001-11-22' });
	});

	it('renders and reads back an instant with a Bengali date and a 12-hour clock', () => {
		const datetime = getField('datetime');
		expect(datetime).toBeDefined();
		if (datetime === undefined) {
			return;
		}
		const shown = datetime.formatDisplay('2001-11-22T13:45:00Z', bengali);
		expect(datetime.parse(shown, bengali)).toEqual({ ok: true, value: '2001-11-22T13:45:00Z' });
	});

	it('reads a currency amount with a Bengali symbol and numerals', () => {
		const currency = getField('currency');
		expect(currency).toBeDefined();
		if (currency === undefined) {
			return;
		}
		const ctx = makeContext({ locale: 'bn-BD', fieldOptions: { symbol: '৳', precision: 2 } });
		const shown = currency.formatDisplay(1234.5, ctx);
		expect(currency.parse(shown, ctx)).toEqual({ ok: true, value: 1234.5 });
	});

	it('groups digits the way the locale does, including Indian grouping', () => {
		const number = getField('number');
		expect(number).toBeDefined();
		if (number === undefined) {
			return;
		}
		expect(number.parse('12,34,567', bengali)).toEqual({ ok: true, value: 1234567 });
		expect(number.formatDisplay(1234567, bengali)).toBe('১২,৩৪,৫৬৭');
	});

	it('keeps a stable day key in the vault’s timezone but with ASCII digits', () => {
		const datetime = getField('datetime');
		expect(datetime).toBeDefined();
		if (datetime === undefined) {
			return;
		}
		expect(datetime.groupKey('2001-11-22T13:45:00Z', bengali)).toBe('2001-11-22');
	});
});

describe('a vault whose locale tag is broken', () => {
	const broken = makeContext({ locale: 'not a locale' });

	it('renders through the fallback and still reads its own output back', () => {
		const number = getField('number');
		const date = getField('date');
		const datetime = getField('datetime');
		expect(number).toBeDefined();
		expect(date).toBeDefined();
		expect(datetime).toBeDefined();
		if (number === undefined || date === undefined || datetime === undefined) {
			return;
		}
		const numberShown = number.formatDisplay(1234.5, broken);
		expect(numberShown).toBe('1,234.5');
		expect(number.parse(numberShown, broken)).toEqual({ ok: true, value: 1234.5 });

		const dateShown = date.formatDisplay('2026-10-05', broken);
		expect(date.parse(dateShown, broken)).toEqual({ ok: true, value: '2026-10-05' });

		const instantShown = datetime.formatDisplay('2026-10-05T09:30:00Z', broken);
		expect(datetime.parse(instantShown, broken)).toEqual({
			ok: true,
			value: '2026-10-05T09:30:00Z',
		});
	});

	it('records why the locale could not be used, so a settings screen can say so', () => {
		const numberProblem = numberLocaleProblem('not a locale');
		const dateProblem = dateLocaleProblem('not a locale');
		expect(numberProblem).toContain('not a locale');
		expect(dateProblem).toContain('not a locale');
		expect(numberProblem).toContain('RangeError');
	});

	it('refuses a wall-clock reading it cannot place in a zone, and never throws', () => {
		const datetime = getField('datetime');
		expect(datetime).toBeDefined();
		if (datetime === undefined) {
			return;
		}
		const ctx = makeContext({ timezone: 'Nonsense/Zone' });
		const parsed = datetime.parse('2026-10-05 09:30', ctx);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) {
			expect(parsed.error).toContain('Nonsense/Zone');
		}
		// A canonical value carries its own offset, so a broken zone setting cannot break it.
		expect(datetime.parse('2026-10-05T09:30:00Z', ctx)).toEqual({
			ok: true,
			value: '2026-10-05T09:30:00Z',
		});
	});
});

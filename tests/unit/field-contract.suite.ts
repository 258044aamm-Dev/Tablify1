/**
 * The field-type contract, as executable assertions. One shared suite instead of one hand-written test file
 * per type: step 07 points this at every descriptor in the registry, so a new type is proven the moment it
 * registers, and a type that quietly stops honouring the contract fails here rather than in the grid.
 *
 * The suite is a function, not a test file: it registers cases inside the caller's `describe`, with the
 * caller's fixtures. Every assertion below is about *shape* — round-trips, ordering, YAML safety — because
 * those are the properties the grid, the clipboard, the query engine and the write queue all depend on.
 */
import { describe, expect, it } from 'vitest';
import type {
	CellValue,
	FieldContext,
	FieldDescriptor,
	FieldTypeId,
	FilterOpId,
} from '../../src/core/types';
import { createFakeClock } from '../fakes/clock';

/**
 * The mapping table of `docs/03`, in that table's own order — **the list this build is measured against**.
 *
 * It lives here, in the shared test support, because two suites assert against it for different reasons:
 * `registry.test.ts` proves the registered set *equals* it, and `field-contract.all.test.ts` proves every one
 * of those types has a fixture in the shared contract suite. One definition means a change to `docs/03` can
 * never be reflected in only one of them.
 */
export const DOCS_03_TYPES: readonly FieldTypeId[] = [
	'text',
	'longText',
	'number',
	'checkbox',
	'date',
	'datetime',
	'url',
	'email',
	'phone',
	'singleSelect',
	'multiSelect',
	'rating',
	'currency',
	'percent',
	'duration',
	'attachment',
];

/**
 * Ids that exist in the legacy type vocabulary but must never be registered as ordinary cell types.
 * `createdTime`/`lastModifiedTime` are read-only metadata: the Bases adapter supplies file times (P11),
 * while a native `.tablify` view derives them from each row's `createdAt`/`updatedAt` metadata (R3 step 7).
 */
export const NEVER_STORED_FIELD_IDS: readonly FieldTypeId[] = ['createdTime', 'lastModifiedTime'];

/**
 * A commit-stable "now" for every fixture: 2025-09-24T06:26:40Z. Time-dependent formats (a date cell, a
 * "modified 2 days ago" tooltip) then produce the same string on every machine and every run.
 */
const FIXED_NOW = 1_758_695_200_000;

/** Builds a deterministic context. Override one field when a case is about that field. */
export function makeContext(overrides: Partial<FieldContext> = {}): FieldContext {
	const clock = createFakeClock(FIXED_NOW);
	return {
		now: () => clock.now(),
		timezone: 'UTC',
		locale: 'en-GB',
		fieldOptions: {},
		columnName: 'Notes',
		...overrides,
	};
}

/**
 * A very long string. The step asks for a 1e9-character input; that allocates roughly two gigabytes and
 * would take the runner out with an out-of-memory error instead of a failing assertion. One million
 * characters proves the same property — that nothing in the path is quadratic or back-trackingly
 * regex-based — and the separate "long input through every operator" case below is where that is checked.
 */
export const LONG_TEXT = 'x'.repeat(1_000_000);

/**
 * Inputs `parse` must survive. None of these is a valid cell value; all of them are things a hand-edited
 * note, a synced file or a bad spreadsheet export can actually contain.
 */
export const HOSTILE_INPUTS: readonly { readonly label: string; readonly value: unknown }[] = [
	{ label: 'null', value: null },
	{ label: 'undefined', value: undefined },
	{ label: 'an empty object', value: {} },
	{ label: 'an object with a value', value: { nested: { deep: true } } },
	{ label: 'an empty array', value: [] },
	{ label: 'an array of objects', value: [{ a: 1 }] },
	{ label: 'a number where text is expected', value: 42 },
	{ label: 'NaN', value: Number.NaN },
	{ label: 'Infinity', value: Number.POSITIVE_INFINITY },
	{ label: 'a boolean', value: true },
	{ label: 'a function', value: () => 'no' },
	{ label: 'a symbol', value: Symbol('nope') },
	{ label: 'a Date object', value: new Date(FIXED_NOW) },
	{ label: 'a 1,000,000-character string', value: LONG_TEXT },
	{ label: 'emoji, including a ZWJ sequence', value: '👩‍👩‍👧‍👦 🎉 🇯🇵' },
	{ label: 'right-to-left text mixed with digits', value: 'مرحبا 123 שלום' },
	{ label: 'a string containing NUL', value: 'a\u0000b' },
	{ label: 'leading and trailing whitespace', value: '   ' },
];

/** One filter case: the operator, the value, the operand, and what `matches` must answer. */
export type FilterCase<TValue> = {
	readonly op: FilterOpId;
	readonly value: TValue;
	readonly operand: unknown;
	readonly expect: boolean;
};

/** What a type must supply for the shared suite to be meaningful. */
export type FieldFixture<TValue> = {
	/** Canonical values that must survive both round-trips. Keep whitespace-only strings out of this list. */
	readonly values: readonly TValue[];
	/** At least one case per declared operator, with the expected answer. */
	readonly filterCases: readonly FilterCase<TValue>[];
	/** Extra hostile inputs beyond {@link HOSTILE_INPUTS}. */
	readonly hostile?: readonly { readonly label: string; readonly value: unknown }[];
	/** The context every call uses. */
	readonly ctx: FieldContext;
};

/** Thrown when a value reaching `toJson` is not a YAML-safe shape. */
function yamlProblem(value: unknown, path: string, depth: number): string | undefined {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return undefined;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value)
			? undefined
			: `${path} is ${String(value)}; YAML has no such number`;
	}
	if (Array.isArray(value)) {
		if (depth > 0) {
			return `${path} is a nested list; frontmatter holds scalars or one flat list`;
		}
		const items: readonly unknown[] = value;
		for (const [index, item] of items.entries()) {
			const problem = yamlProblem(item, `${path}[${index}]`, depth + 1);
			if (problem !== undefined) {
				return problem;
			}
		}
		return undefined;
	}
	return `${path} is ${typeof value}; frontmatter holds scalars or a flat list of scalars`;
}

/** Sign of a comparison, normalised, so a type may return any negative/positive number it likes. */
function sign(value: number): -1 | 0 | 1 {
	return value === 0 ? 0 : value > 0 ? 1 : -1;
}

/**
 * Asserts the whole contract for one descriptor. Call inside a `describe`, at collection time.
 *
 * Covers: display and plain-text round-trips for every fixture value; `toJson` returning YAML-safe shapes;
 * `compare` being a total order whose zero agrees with `groupKey`; every declared filter operator having a
 * case and producing the expected boolean; and `parse` surviving the hostile table without throwing.
 */
export function runFieldContractSuite<TValue extends CellValue>(
	field: FieldDescriptor<TValue>,
	fixture: FieldFixture<TValue>,
): void {
	const ctx = fixture.ctx;

	describe(`${field.id} — the field contract`, () => {
		it('declares a usable identity', () => {
			expect(field.id).not.toBe('');
			expect(field.label).not.toBe('');
			expect(field.icon).not.toBe('');
			expect(typeof field.editable).toBe('boolean');
			expect(field.filterOps.length).toBeGreaterThan(0);
			expect(new Set(field.filterOps).size).toBe(field.filterOps.length);
		});

		it('parse(formatDisplay(v)) round-trips for every canonical value', () => {
			for (const value of fixture.values) {
				const text = field.formatDisplay(value, ctx);
				expect(typeof text).toBe('string');
				const back = field.parse(text, ctx);
				expect(back.ok, `parse(formatDisplay(${JSON.stringify(value)})) failed`).toBe(true);
				if (back.ok) {
					expect(back.value, `round-trip changed ${JSON.stringify(value)}`).toEqual(
						value,
					);
				}
			}
		});

		it('parsePlain(formatPlain(v)) round-trips for every canonical value', () => {
			for (const value of fixture.values) {
				const text = field.formatPlain(value, ctx);
				expect(typeof text).toBe('string');
				const back = field.parsePlain(text, ctx);
				expect(back.ok, `parsePlain(formatPlain(${JSON.stringify(value)})) failed`).toBe(
					true,
				);
				if (back.ok) {
					expect(back.value, `plain round-trip changed ${JSON.stringify(value)}`).toEqual(
						value,
					);
				}
			}
		});

		it('the default value is itself a canonical value', () => {
			const back = field.parse(field.toJson(field.defaultValue, ctx), ctx);
			expect(back.ok || field.defaultValue === null).toBe(true);
			if (back.ok) {
				expect(back.value).toEqual(field.defaultValue);
			}
		});

		it('toJson returns only YAML-safe shapes', () => {
			for (const value of fixture.values) {
				const yaml = field.toJson(value, ctx);
				const problem = yamlProblem(yaml, `toJson(${JSON.stringify(value)})`, 0);
				if (problem !== undefined) {
					throw new Error(problem);
				}
			}
		});

		it('compare is a total order consistent with groupKey', () => {
			const values = fixture.values;
			// The fixture must contain distinct values, or the ordering assertions below are vacuous.
			expect(new Set(values.map((value) => field.groupKey(value, ctx))).size).toBeGreaterThan(
				1,
			);

			for (const a of values) {
				expect(sign(field.compare(a, a, ctx)), `compare(v, v) must be 0`).toBe(0);
				for (const b of values) {
					const forward = sign(field.compare(a, b, ctx));
					const backward = sign(field.compare(b, a, ctx));
					// Summed, not negated: `expect(0).toBe(-0)` fails under Object.is, and `compare(v, v)` is 0.
					expect(
						forward + backward,
						`antisymmetry broke for ${JSON.stringify([a, b])}`,
					).toBe(0);

					if (forward === 0) {
						expect(
							field.groupKey(a, ctx),
							`compare said ${JSON.stringify([a, b])} are equal but groupKey disagrees`,
						).toBe(field.groupKey(b, ctx));
					}
					for (const c of values) {
						if (forward <= 0 && sign(field.compare(b, c, ctx)) <= 0) {
							expect(
								sign(field.compare(a, c, ctx)),
								`transitivity broke for ${JSON.stringify([a, b, c])}`,
							).toBeLessThanOrEqual(0);
						}
					}
				}
			}
		});

		it('implements every operator it declares, and only those', () => {
			const covered = new Set(fixture.filterCases.map((testCase) => testCase.op));
			for (const op of field.filterOps) {
				expect(
					covered.has(op),
					`${field.id} declares "${op}" but no case exercises it`,
				).toBe(true);
			}
			for (const testCase of fixture.filterCases) {
				expect(
					field.filterOps.includes(testCase.op),
					`the fixture uses "${testCase.op}", which ${field.id} does not declare`,
				).toBe(true);
				const answer = field.matches(testCase.value, testCase.op, testCase.operand, ctx);
				expect(typeof answer, `matches() must return a boolean for "${testCase.op}"`).toBe(
					'boolean',
				);
				expect(
					answer,
					`matches(${JSON.stringify(testCase.value)}, "${testCase.op}", ${JSON.stringify(testCase.operand)})`,
				).toBe(testCase.expect);
			}
		});

		it('answers every declared operator for values it was never given', () => {
			// A filter runs against whatever is in the column, including the empty value and a hostile shape.
			for (const op of field.filterOps) {
				const sample = fixture.filterCases.find((testCase) => testCase.op === op);
				const operand = sample === undefined ? undefined : sample.operand;
				for (const value of [...fixture.values, field.defaultValue]) {
					expect(typeof field.matches(value, op, operand, ctx)).toBe('boolean');
				}
				expect(typeof field.matches(field.defaultValue, op, undefined, ctx)).toBe(
					'boolean',
				);
			}
		});

		it('parse never throws, for any hostile input', () => {
			const cases = [...HOSTILE_INPUTS, ...(fixture.hostile ?? [])];
			for (const testCase of cases) {
				let result: ReturnType<FieldDescriptor<TValue>['parse']> | undefined;
				expect(() => {
					result = field.parse(testCase.value, ctx);
				}, `parse threw on ${testCase.label}`).not.toThrow();
				expect(result, `parse returned nothing for ${testCase.label}`).toBeDefined();
				if (result === undefined) {
					continue;
				}
				expect(
					typeof result.ok,
					`parse must return a tagged result for ${testCase.label}`,
				).toBe('boolean');
				if (!result.ok) {
					expect(
						result.error.length,
						`the failure for ${testCase.label} needs a reason`,
					).toBeGreaterThan(0);
					expect(
						result.raw,
						`the failure for ${testCase.label} must carry its input`,
					).toBe(testCase.value);
				}
			}
		});

		it('parsePlain never throws, for any hostile text', () => {
			const texts = ['', '   ', LONG_TEXT, '👩‍👩‍👧‍👦', 'مرحبا 123', '\t\n', 'a\u0000b'];
			for (const text of texts) {
				expect(
					() => field.parsePlain(text, ctx),
					`parsePlain threw on ${JSON.stringify(text)}`,
				).not.toThrow();
				expect(typeof field.parsePlain(text, ctx).ok).toBe('boolean');
			}
		});

		// Step 06 wrote this for `text`, where a million characters is a valid value. A long string is *not*
		// a valid value for most types (`number`, `date`, `rating`), so the generalised version asserts what
		// is true of every type: a very long input neither throws nor makes an operator or a render
		// pathological, whether it parses or is refused.
		it('survives a very long input in every operator, parsed or refused', () => {
			const long = field.parse(LONG_TEXT, ctx);
			expect(typeof long.ok).toBe('boolean');
			if (!long.ok) {
				expect(long.error.length).toBeGreaterThan(0);
			}
			const values = long.ok ? [...fixture.values, long.value] : fixture.values;
			for (const value of values) {
				expect(typeof field.formatDisplay(value, ctx)).toBe('string');
				for (const op of field.filterOps) {
					expect(typeof field.matches(value, op, LONG_TEXT, ctx)).toBe('boolean');
					expect(typeof field.matches(value, op, '', ctx)).toBe('boolean');
				}
			}
		});
	});
}

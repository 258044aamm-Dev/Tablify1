/**
 * The shared contract suite, pointed at the one type this build ships, plus the cases that are specific to
 * `text`: the whitespace policy, coercion of non-string scalars, and locale-aware comparison.
 *
 * The policy asserted here is the one the descriptor's header states: frontmatter-authored text keeps its
 * whitespace, pasted text is trimmed, and a value that is only whitespace is the empty value in both paths.
 * That is why no value in the fixture below is padded or empty — an empty string cannot be a canonical
 * `text` value, so the round-trip assertions are about values that can exist.
 */
import { describe, expect, it } from 'vitest';
import { textField } from '../../src/core/fieldTypes/text';
import { makeContext, runFieldContractSuite } from './field-contract.suite';

const ctx = makeContext();

runFieldContractSuite(textField, {
	ctx,
	values: [
		null,
		'Widening',
		'alpha',
		'Beta',
		'Zulu',
		'note 2',
		'Björn',
		'道路',
		'مرحبا',
		'🎉 party',
	],
	filterCases: [
		{ op: 'is', value: 'Widening', operand: 'widening', expect: true },
		{ op: 'is', value: null, operand: '', expect: true },
		{ op: 'isNot', value: 'Widening', operand: 'Narrowing', expect: true },
		{ op: 'isNot', value: 'Widening', operand: 'widening', expect: false },
		{ op: 'contains', value: 'Widening the road', operand: 'the', expect: true },
		{ op: 'contains', value: 'Widening', operand: 'narrow', expect: false },
		{ op: 'notContains', value: 'Widening the road', operand: 'bridge', expect: true },
		{ op: 'startsWith', value: 'Widening', operand: 'Wid', expect: true },
		{ op: 'startsWith', value: 'Widening', operand: 'widening', expect: true },
		{ op: 'startsWith', value: 'Widening', operand: 'ening', expect: false },
		{ op: 'endsWith', value: 'Widening', operand: 'ing', expect: true },
		{ op: 'isEmpty', value: null, operand: undefined, expect: true },
		{ op: 'isEmpty', value: 'x', operand: undefined, expect: false },
		{ op: 'isNotEmpty', value: 'x', operand: undefined, expect: true },
		{ op: 'isNotEmpty', value: null, operand: undefined, expect: false },
	],
});

describe('text — the whitespace policy', () => {
	it('preserves whitespace in frontmatter-authored text', () => {
		const result = textField.parse('  padded  ', ctx);
		expect(result).toEqual({ ok: true, value: '  padded  ' });
	});

	it('trims pasted text, because a spreadsheet cell pads without meaning to', () => {
		expect(textField.parsePlain('  padded  ', ctx)).toEqual({ ok: true, value: 'padded' });
	});

	it('normalises pasted text to NFC, so the same name from two apps is one value', () => {
		const decomposed = 'e\u0301'; // e followed by COMBINING ACUTE ACCENT
		expect(textField.parsePlain(decomposed, ctx)).toEqual({ ok: true, value: 'é' });
		// Authored text is never rewritten: the code points the user typed are the value.
		expect(textField.parse(decomposed, ctx)).toEqual({ ok: true, value: decomposed });
	});

	it('ends a tie with a code-point comparison, so visually identical text still sorts deterministically', () => {
		const decomposed = 'e\u0301';
		// These collate equal at variant sensitivity, so without the tiebreak connect would be 0 and two
		// distinct values would share a group key.
		expect(decomposed.localeCompare('é', 'en-GB', { sensitivity: 'variant' })).toBe(0);
		// The tiebreak is code-point order, so the decomposed form sorts first: "e" (U+0065) < "é" (U+00E9).
		expect(textField.compare(decomposed, 'é', ctx)).toBeLessThan(0);
		expect(textField.compare('é', decomposed, ctx)).toBeGreaterThan(0);
		expect(textField.groupKey(decomposed, ctx)).not.toBe(textField.groupKey('é', ctx));
	});

	it('treats a whitespace-only value as the empty value in both paths', () => {
		expect(textField.parse('   ', ctx)).toEqual({ ok: true, value: null });
		expect(textField.parse('\t\n', ctx)).toEqual({ ok: true, value: null });
		expect(textField.parsePlain('   ', ctx)).toEqual({ ok: true, value: null });
	});

	it('mirrors the policy in toJson: the value is written verbatim, absence is null', () => {
		expect(textField.toJson('  padded  ', ctx)).toBe('  padded  ');
		expect(textField.toJson(null, ctx)).toBeNull();
		expect(textField.toJson('', ctx)).toBe('');
	});
});

describe('text — coercion and refusal', () => {
	it('stringifies a number or a boolean, so a note holding title: 42 shows something', () => {
		expect(textField.parse(42, ctx)).toEqual({ ok: true, value: '42' });
		expect(textField.parse(false, ctx)).toEqual({ ok: true, value: 'false' });
	});

	it('joins a list of strings with a comma and rejects a mixed list', () => {
		expect(textField.parse(['road', 'bridge'], ctx)).toEqual({
			ok: true,
			value: 'road, bridge',
		});
		expect(textField.parse([], ctx)).toEqual({ ok: true, value: null });
		const mixed = textField.parse(['road', 7], ctx);
		expect(mixed.ok).toBe(false);
		expect(mixed.ok ? '' : mixed.error).toContain('non-text members');
	});

	it('refuses an object with the input attached, rather than inventing text', () => {
		const result = textField.parse({ a: 1 }, ctx);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe('text expects a string');
			expect(result.raw).toEqual({ a: 1 });
		}
	});
});

describe('text — comparison and grouping', () => {
	it('sorts case variants apart, so groupKey equality and compare agree', () => {
		expect(textField.compare('a', 'A', ctx)).not.toBe(0);
		expect(textField.groupKey('a', ctx)).not.toBe(textField.groupKey('A', ctx));
	});

	it('sorts the absent value last', () => {
		expect(textField.compare(null, 'Zulu', ctx)).toBe(1);
		expect(textField.compare('Zulu', null, ctx)).toBe(-1);
		expect(textField.compare(null, null, ctx)).toBe(0);
	});

	it('compares text, not numbers: "note 10" sorts before "note 2"', () => {
		expect(textField.compare('note 10', 'note 2', ctx)).toBeLessThan(0);
	});

	it('folds case with the context locale, so a Turkish capital I is not the same as a dotless i', () => {
		const turkish = makeContext({ locale: 'tr' });
		expect(textField.matches('I', 'is', 'i', turkish)).toBe(false);
		expect(textField.matches('I', 'is', 'ı', turkish)).toBe(true);
		// …and under a locale without that rule, the two are the same letter for filtering purposes.
		expect(textField.matches('I', 'is', 'i', ctx)).toBe(true);
	});
});

describe('text — operators it does not declare', () => {
	it('answers false instead of comparing strings numerically', () => {
		expect(textField.matches('10', 'gt', 5, ctx)).toBe(false);
		expect(textField.matches('10', 'lte', 5, ctx)).toBe(false);
	});

	it('coerces a non-string operand instead of throwing', () => {
		expect(textField.matches('42', 'is', 42, ctx)).toBe(true);
		expect(textField.matches('Widening', 'contains', { a: 1 }, ctx)).toBe(false);
		expect(textField.matches('Widening', 'contains', null, ctx)).toBe(true);
	});
});

/**
 * The large generated fixture — R1 step 9's "large database fixture generated reproducibly".
 *
 * The file is built by `tests/helpers/large-document.ts` from a fixed seed rather than committed,
 * for the same reason the round-trip property test generates documents instead of listing them:
 * 5000 rows of JSON in git would cost every reviewer and buy nothing. What matters is asserted
 * here — the generation is byte-stable, the document is coherent (zero findings), the parse is
 * lossless at volume, and the whole thing is big enough that "it happened to pass on a toy" is not
 * an explanation. The measured size is part of the test output so ADR-0009's later measurements
 * start from a number, not a feeling.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/index';
import { buildLargeDocumentText } from '../helpers/large-document';

const SHOOTS = 5000;
const CLIENTS = 200;
const BYTES = buildLargeDocumentText().length;

describe('the large generated fixture', () => {
	it(`is byte-identical across builds — ${SHOOTS} + ${CLIENTS} rows, ${BYTES.toLocaleString('en-US')} bytes`, () => {
		const first = buildLargeDocumentText();
		const second = buildLargeDocumentText();
		expect(second).toBe(first);
		expect(first.length).toBeGreaterThan(1_000_000);
	});

	it('a different seed produces a different (still coherent) document', () => {
		const other = buildLargeDocumentText({ seed: 7 });
		expect(other).not.toBe(buildLargeDocumentText());
		const result = parseDocument(other);
		expect(result.ok).toBe(true);
	});

	it('loads without a single finding and keeps every row in order', () => {
		const result = parseDocument(buildLargeDocumentText());
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.warnings).toEqual([]);
		const shoots = result.document.tables[0];
		const clients = result.document.tables[1];
		expect(shoots?.rows.length).toBe(SHOOTS);
		expect(clients?.rows.length).toBe(CLIENTS);
		expect(shoots?.rows[0]?.id).toBe('row_00000000000000000000000000');
		expect(shoots?.rows[SHOOTS - 1]?.id).toBe(
			`row_${(SHOOTS - 1).toString(36).padStart(26, '0')}`,
		);
	});

	it('round-trips at volume: model-identical, byte-stable, no row lost', () => {
		const first = parseDocument(buildLargeDocumentText());
		if (!first.ok) {
			throw new Error('the large fixture must load');
		}
		const once = serializeDocument(first.document);
		const second = parseDocument(once);
		expect(second.ok).toBe(true);
		if (!second.ok) {
			return;
		}
		expect(second.document).toEqual(first.document);
		expect(serializeDocument(second.document)).toBe(once);
		const perTable = second.document.tables.map((table) => table.rows.length);
		expect(perTable).toEqual([SHOOTS, CLIENTS]);
	});
});

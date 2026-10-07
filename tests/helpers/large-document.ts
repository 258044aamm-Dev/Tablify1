/**
 * A large, reproducible `.tablify` document — the "large database fixture" of R1 step 9.
 *
 * It is generated, not committed: a 5000-row file would drown every diff that touches the fixtures
 * directory, and the thing worth testing is that generation with a fixed seed is byte-identical on
 * every run and machine. `mulberry32` is the same tiny PRNG the other property tests use, so the
 * whole repository keeps one definition of "deterministic".
 *
 * The shape is deliberately ordinary — two tables, a link with a declared inverse, selects, dates,
 * numbers, text, three views — because the point is volume, not edge cases: the matrix fixtures own
 * the edges, this one proves the parser stays linear and lossless when there is a lot of it.
 */

/** Words the generator assembles into deterministic text values. */
const WORDS = [
	'rooftop',
	'dawn',
	'studio',
	'session',
	'client',
	'brief',
	'camera',
	'lens',
	'colour',
	'grade',
	'call',
	'sheet',
	'scout',
	'location',
	'moodboard',
	'edit',
	'delivery',
	'invoice',
] as const;

/** A tiny seeded PRNG (mulberry32): same seed in, same stream out, on every engine. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A 26-character id body from a counter, so ids are unique and compare as plain strings. */
function body(counter: number): string {
	return counter.toString(36).padStart(26, '0');
}

function id(kind: string, counter: number): string {
	return `${kind}_${body(counter)}`;
}

/** One field object, as plain JSON, in the house shape. */
type Json = string | number | boolean | Json[] | { [key: string]: Json };

export interface LargeDocumentOptions {
	/** Rows in the big table. */
	readonly shoots?: number;
	/** Rows in the small table each shoot links to. */
	readonly clients?: number;
	/** Seed for the PRNG. Changing it produces a different (still valid) document. */
	readonly seed?: number;
}

/**
 * Build the document text. Deterministic: the same options produce byte-identical text.
 */
export function buildLargeDocumentText(options: LargeDocumentOptions = {}): string {
	const shoots = options.shoots ?? 5000;
	const clients = options.clients ?? 200;
	const seed = options.seed ?? 20261007;
	const random = mulberry32(seed);

	const dbId = id('db', 1);
	const tShoots = id('tbl', 2);
	const tClients = id('tbl', 3);

	const fTitle = id('fld', 10);
	const fNotes = id('fld', 11);
	const fCount = id('fld', 12);
	const fGrade = id('fld', 13);
	const fDay = id('fld', 14);
	const fDone = id('fld', 15);
	const fStatus = id('fld', 16);
	const fTags = id('fld', 17);
	const fClient = id('fld', 18);
	const fClientName = id('fld', 19);
	const fInverse = id('fld', 20);
	const optPlanned = id('opt', 30);
	const optDone = id('opt', 31);
	const optHold = id('opt', 32);

	const clientRows: Json[] = [];
	for (let index = 0; index < clients; index += 1) {
		clientRows.push({
			id: id('row', 1000000 + index),
			cells: { [fClientName]: `${WORDS[index % WORDS.length] ?? 'client'} ${String(index)}` },
		});
	}

	const shootRows: Json[] = [];
	for (let index = 0; index < shoots; index += 1) {
		const word = WORD_AT(random());
		const linked = id('row', 1000000 + Math.floor(random() * clients));
		const row: { [key: string]: Json } = {
			id: id('row', index),
			cells: {
				[fTitle]: `${word} ${String(index)}`,
				[fNotes]: `${word}\nsecond line ${String(index % 17)}`,
				[fCount]: Math.floor(random() * 1000) / 4,
				[fGrade]: Math.floor(random() * 6) / 2,
				[fDay]: `2026-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
				[fDone]: index % 3 === 0,
				[fStatus]: [optPlanned, optDone, optHold][index % 3] ?? optPlanned,
				[fTags]: index % 2 === 0 ? [optPlanned, optDone] : [optHold],
				[fClient]: linked,
			},
		};
		if (index % 10 === 0) {
			row['createdAt'] = `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}Z`;
		}
		shootRows.push(row);
	}

	const document: Json = {
		format: 'tablify',
		version: 1,
		databaseId: dbId,
		name: 'Large fixture',
		tables: [
			{
				id: tShoots,
				name: 'Shoots',
				fields: [
					{ id: fTitle, name: 'Title', type: 'text' },
					{ id: fNotes, name: 'Notes', type: 'longText' },
					{ id: fCount, name: 'Count', type: 'number' },
					{ id: fGrade, name: 'Grade', type: 'rating', max: 5 },
					{ id: fDay, name: 'Day', type: 'date' },
					{ id: fDone, name: 'Done', type: 'checkbox' },
					{
						id: fStatus,
						name: 'Status',
						type: 'singleSelect',
						options: [
							{ id: optPlanned, name: 'Planned' },
							{ id: optDone, name: 'Done' },
							{ id: optHold, name: 'On hold' },
						],
					},
					{
						id: fTags,
						name: 'Tags',
						type: 'multiSelect',
						options: [
							{ id: optPlanned, name: 'Planned' },
							{ id: optDone, name: 'Done' },
							{ id: optHold, name: 'On hold' },
						],
					},
					{
						id: fClient,
						name: 'Client',
						type: 'link',
						targetTableId: tClients,
						allowMultiple: false,
						inverseFieldId: fInverse,
					},
				],
				rows: shootRows,
				views: [
					{
						id: id('viw', 50),
						name: 'All',
						sorts: [{ fieldId: fDay, direction: 'asc' }],
						columnOrder: [fTitle, fStatus, fClient],
						widths: { [fTitle]: 240, [fStatus]: 120 },
					},
					{
						id: id('viw', 51),
						name: 'Outstanding',
						filter: { version: 1, expr: { kind: 'empty', fieldId: fDay } },
						hiddenFieldIds: [fNotes],
					},
					{
						id: id('viw', 52),
						name: 'By client',
						groupBy: fClient,
					},
				],
			},
			{
				id: tClients,
				name: 'Clients',
				fields: [
					{ id: fClientName, name: 'Name', type: 'text' },
					{
						id: fInverse,
						name: 'Shoots',
						type: 'link',
						targetTableId: tShoots,
						allowMultiple: true,
						generated: true,
					},
				],
				rows: clientRows,
				views: [],
			},
		],
	};
	return `${JSON.stringify(document, null, 2)}\n`;
}

/** The word at a PRNG draw, without an assertion the lint would refuse. */
function WORD_AT(draw: number): string {
	return WORDS[Math.floor(draw * WORDS.length)] ?? 'shoot';
}

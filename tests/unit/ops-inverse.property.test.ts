/**
 * The inverse property, over generated sequences.
 *
 * `docs/07` §Tier 1 states it: "Ops tests assert the **inverse** for every op: `apply(undo(apply(x))) === x`.
 * Undo correctness is a property, so it gets property-style tests over generated op sequences." This is that
 * test. 100 sequences of 20 ops over a seeded PRNG (mulberry32, written here so the suite keeps its zero
 * dependencies and a failure is reproducible from the seed alone):
 *
 * 1. every op that took effect is inverted **on its own** and applied again — the state must come back
 *    deep-equal, including the row order and including the absence of keys that held no value;
 * 2. the whole sequence is then undone, one step at a time, and must land on the state the sequence started
 *    from (which is the ordering rule: a batch is undone last-first);
 * 3. and redone, which must land on the state the sequence ended in — undo then redo is the identity.
 *
 * Ops that `apply` reports as skipped are **not pushed**: the store drops what did not take effect, because
 * the inverse of a write that never happened would still delete or overwrite something. The counts, being
 * numbers, go in the test names (`AGENTS.md`: no console output anywhere in this repository).
 */
import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, captureBefore } from '../../src/core/ops/apply';
import { createHistory } from '../../src/core/ops/history';
import { invertAll } from '../../src/core/ops/inverse';
import type { Command } from '../../src/core/ops/history';
import type { Op, OpKind, TableState } from '../../src/core/ops/types';
import { OP_KINDS } from '../../src/core/ops/types';
import { buildOp, freshState } from './ops-fixtures';

/** How many sequences, and how many ops in each. The step's own budget: 100 × 20. */
const SEQUENCES = 100;
const OPS_PER_SEQUENCE = 20;

/** mulberry32: 32 bits of state, uniform enough for this, and reproducible from one number. */
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

/** `typeof value === 'object'` with the two traps (null, arrays) handled. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality for plain data: same keys, same values, same order in arrays. */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((value, index) => deepEqual(value, b[index]));
	}
	if (!isRecord(a) || !isRecord(b)) {
		return false;
	}
	const keysA = Object.keys(a).sort();
	const keysB = Object.keys(b).sort();
	if (keysA.length !== keysB.length || !keysA.every((key, index) => key === keysB[index])) {
		return false;
	}
	return keysA.every((key) => deepEqual(a[key], b[key]));
}

/** What one run of the generator found. Every number here is asserted, and named, by the tests below. */
type Analysis = {
	readonly sequences: number;
	readonly opsPerSequence: number;
	readonly opsGenerated: number;
	readonly opsApplied: number;
	readonly opsSkipped: number;
	readonly singleStepFailures: number;
	readonly sequenceFailures: number;
	readonly redoFailures: number;
	readonly cleanRounds: number;
	readonly kindsSeen: readonly OpKind[];
};

/** Runs the three properties over every generated sequence, and counts what happened. */
function analyse(): Analysis {
	let opsGenerated = 0;
	let opsApplied = 0;
	let opsSkipped = 0;
	let singleStepFailures = 0;
	let sequenceFailures = 0;
	let redoFailures = 0;
	let cleanRounds = 0;
	const seen = new Set<OpKind>();
	for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
		const random = mulberry32(0x9e3779b9 ^ (sequence * 1000003));
		const history = createHistory();
		let state = freshState();
		const start = state;
		let clean = true;
		for (let step = 0; step < OPS_PER_SEQUENCE; step += 1) {
			const kind = OP_KINDS[Math.floor(random() * OP_KINDS.length)] ?? 'setCell';
			const op: Op = buildOp(kind, sequence * 100 + step, state);
			seen.add(op.kind);
			opsGenerated += 1;
			const before = captureBefore(op, state);
			const applied = applyOp(state, op);
			if (applied.skipped.length > 0) {
				opsSkipped += 1;
				// A skipped op changed nothing, so there is nothing to undo and nothing to push.
				continue;
			}
			opsApplied += 1;
			const inverted = invertAll([op], [before]);
			if (!inverted.ok) {
				singleStepFailures += 1;
				clean = false;
			} else {
				const back = applyOps(applied.state, inverted.ops).state;
				if (!deepEqual(back, state)) {
					singleStepFailures += 1;
					clean = false;
				}
			}
			const command: Command = {
				label: `${kind} ${String(step)}`,
				ops: [op],
				befores: [before],
			};
			history.push(command);
			state = applied.state;
		}

		const end = state;
		const steps = history.depth();
		for (let index = 0; index < steps; index += 1) {
			const undone = history.undo();
			if (!undone.ok) {
				sequenceFailures += 1;
				clean = false;
				break;
			}
			state = applyOps(state, undone.ops).state;
		}
		if (!deepEqual(state, start)) {
			sequenceFailures += 1;
			clean = false;
		}
		for (let index = 0; index < steps; index += 1) {
			const redone = history.redo();
			if (!redone.ok) {
				redoFailures += 1;
				clean = false;
				break;
			}
			state = applyOps(state, redone.ops).state;
		}
		if (!deepEqual(state, end)) {
			redoFailures += 1;
			clean = false;
		}
		if (clean) {
			cleanRounds += 1;
		}
	}
	return {
		sequences: SEQUENCES,
		opsPerSequence: OPS_PER_SEQUENCE,
		opsGenerated,
		opsApplied,
		opsSkipped,
		singleStepFailures,
		sequenceFailures,
		redoFailures,
		cleanRounds,
		kindsSeen: [...seen].sort(),
	};
}

/** Run once at module load; the tests then assert what it found and carry the numbers in their names. */
const ANALYSIS = analyse();

describe('the inverse property', () => {
	it(`holds ${String(OPS_PER_SEQUENCE)} ops deep for all ${String(SEQUENCES)} sequences: ${String(ANALYSIS.opsApplied)} ops applied, ${String(ANALYSIS.opsSkipped)} skipped as impossible, ${String(ANALYSIS.singleStepFailures)} single-step failures`, () => {
		expect(ANALYSIS.singleStepFailures).toBe(0);
		// The generator must be doing real work: if nearly everything were skipped, the property would be
		// passing over an empty sequence and proving nothing.
		expect(ANALYSIS.opsApplied).toBeGreaterThan(SEQUENCES * OPS_PER_SEQUENCE * 0.8);
		expect(ANALYSIS.opsSkipped).toBeGreaterThan(0);
	});

	it(`undoes ${String(SEQUENCES)} whole sequences back to where they started, with ${String(ANALYSIS.sequenceFailures)} failures`, () => {
		expect(ANALYSIS.sequenceFailures).toBe(0);
	});

	it(`redoes them to where they ended, with ${String(ANALYSIS.redoFailures)} failures — undo then redo is the identity`, () => {
		expect(ANALYSIS.redoFailures).toBe(0);
	});

	it(`generates every one of the ${String(OP_KINDS.length)} op kinds and runs ${String(ANALYSIS.cleanRounds)} clean rounds`, () => {
		expect(ANALYSIS.kindsSeen).toEqual([...OP_KINDS].sort());
		expect(ANALYSIS.cleanRounds).toBe(SEQUENCES);
	});

	it('runs the whole analysis quickly enough to sit in the default gate', () => {
		const startedAt = performance.now();
		analyse();
		expect(performance.now() - startedAt).toBeLessThan(2000);
	});

	it('is reproducible: the same seeds produce the same counts', () => {
		const again = analyse();
		expect(again).toEqual(ANALYSIS);
	});
});

describe('the generator itself', () => {
	it('produces the same numbers for the same seed, and different ones for a different seed', () => {
		const first = mulberry32(42);
		const second = mulberry32(42);
		const third = mulberry32(43);
		const a = [first(), first(), first()];
		const b = [second(), second(), second()];
		const c = [third(), third(), third()];
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
		for (const value of a) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	it('compares states the way the property needs it to (arrays and key sets included)', () => {
		const base: TableState = freshState();
		expect(deepEqual(base, freshState())).toBe(true);
		expect(deepEqual(base.rows, [...base.rows])).toBe(true);
		expect(deepEqual(base.rows, [...base.rows].reverse())).toBe(false);
		expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(deepEqual({ a: undefined }, {})).toBe(false);
		expect(deepEqual([1, 'a'], [1, 'a'])).toBe(true);
		expect(deepEqual(null, null)).toBe(true);
		expect(deepEqual(null, undefined)).toBe(false);
	});
});

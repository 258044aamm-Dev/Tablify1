/**
 * Inverses: the function that turns an op into the op that takes it back.
 *
 * Undo is not a snapshot of the table and not a replayed log — it is the same mutation run backwards.
 * That choice is what makes undoing a 400-row import cost the same as undoing one keystroke, and it is why
 * every op in `types.ts` carries the data its inverse needs (the deleted rows, the deleted column's values,
 * the width that was there before the drag).
 *
 * Three kinds cannot carry their own inverse — `setCell`, `setCells` and `clearCells` overwrite values they
 * do not know about — so the caller captures a `Before` (see `captureBefore`) and hands it in. An inverse
 * that cannot be built is *reported*, never guessed at, and never thrown: a step that cannot be inverted is
 * left alone by the history rather than silently becoming a no-op.
 *
 * For a batch, inversion reverses the order. Applying A then B is undone by un-doing B then A — the ordinary
 * rule, and the reason a paste's before-images are captured in write order and replayed backwards.
 */
import type { Before, Inverse, Op } from './types';

/** The inverse of a whole command: the ops, reversed. */
export type Inverted =
	| { readonly ok: true; readonly ops: readonly Op[] }
	| { readonly ok: false; readonly reason: string };

/** The inverse of one op, given the before-image its caller captured. Total: a mismatch is a reason string. */
export function invert(op: Op, before: Before): Inverse {
	switch (op.kind) {
		case 'setCell': {
			if (before.kind !== 'value') {
				return {
					ok: false,
					reason: `undoing a cell edit needs the value it replaced, but a "${before.kind}" before-image was captured`,
				};
			}
			return {
				ok: true,
				op: {
					kind: 'setCell',
					filePath: op.filePath,
					fieldId: op.fieldId,
					value: before.value,
				},
			};
		}

		case 'setCells':
		case 'clearCells': {
			if (before.kind !== 'cells') {
				return {
					ok: false,
					reason: `undoing a matrix write needs the values it replaced, but a "${before.kind}" before-image was captured`,
				};
			}
			// One op, not one per cell: an undo of a paste is one queued batch, exactly as `docs/02` §Store
			// requires ("an undo of a 400-cell paste is one queued batch, not 400 keystroke-level writes").
			return { ok: true, op: { kind: 'setCells', writes: before.writes } };
		}

		case 'addRow': {
			return {
				ok: true,
				op: {
					kind: 'deleteRows',
					rows: [{ at: op.at, row: op.row }],
				},
			};
		}

		case 'deleteRows': {
			return { ok: true, op: { kind: 'importBlock', rows: op.rows } };
		}

		case 'moveRow': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'moveRows': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'setFieldOptions': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'addField': {
			return {
				ok: true,
				op: { kind: 'deleteField', at: op.at, field: op.field, values: op.values },
			};
		}

		case 'deleteField': {
			return {
				ok: true,
				op: { kind: 'addField', at: op.at, field: op.field, values: op.values },
			};
		}

		case 'renameField': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'resizeColumn': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'reorderColumn': {
			return { ok: true, op: { ...op, from: op.to, to: op.from } };
		}

		case 'setGroupCollapse': {
			return { ok: true, op: { ...op, collapsed: !op.collapsed } };
		}

		case 'setViewConfig': {
			return {
				ok: true,
				op: { kind: 'setViewConfig', changes: op.previous, previous: op.changes },
			};
		}

		case 'importBlock': {
			return { ok: true, op: { kind: 'deleteRows', rows: op.rows } };
		}
	}
}

/** Inverts a whole command, reversing the order. `befores` pairs with `ops` position by position. */
export function invertAll(ops: readonly Op[], befores: readonly Before[]): Inverted {
	if (befores.length !== ops.length) {
		return {
			ok: false,
			reason: `this step has ${String(ops.length)} operations but ${String(befores.length)} before-images, so it cannot be undone safely`,
		};
	}
	const reversed: Op[] = [];
	for (let index = ops.length - 1; index >= 0; index -= 1) {
		const op = ops[index];
		const before = befores[index];
		if (op === undefined || before === undefined) {
			return { ok: false, reason: 'this step is missing one of its operations' };
		}
		const inverted = invert(op, before);
		if (!inverted.ok) {
			return { ok: false, reason: inverted.reason };
		}
		reversed.push(inverted.op);
	}
	return { ok: true, ops: reversed };
}

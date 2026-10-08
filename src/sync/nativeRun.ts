/**
 * One sync run for a **native table** (R5 Part C, Steps 4–5).
 *
 * This is the native counterpart of the legacy `runSync` call in `src/plugin/sync/host.ts`. The engine is reused
 * unchanged: this module only translates identities at the edges and decides what to save.
 *
 * ## Identity at the edges
 *
 * - The engine keys fields by the port's property name, which is the **field ID** here. Remote matching is still by
 *   **display name** (`resolveFieldMap`), so the mapping is computed from names and converted back to IDs on the way
 *   out. A stored mapping is looked up by ID, so a local rename keeps it.
 * - Two synced fields that share a display name cannot be matched by name. Both are reported as unmapped and are
 *   not synced; they are never guessed at.
 *
 * ## What a run may and may not do
 *
 * - A pull never creates a local row: remote-only records are reported by the engine and left alone. So the row map
 *   does not change during a run.
 * - The engine's own guards hold: a truncated read or an unresolved conflict writes nothing. This module does not
 *   add a second, weaker check.
 * - The link is saved once, from the returned document, and only by the caller, so a failed run can leave the
 *   previous link untouched.
 *
 * No network and no file access here: the target and the document are inputs. The token never enters this module.
 */
import type { ResolvedField } from '../core/schema/propertySchema';
import type { ResolutionBook } from './diff';
import { runSync } from './pullPush';
import type { SyncDirection, SyncReport } from './pullPush';
import type { NativeSyncPort } from './nativePort';
import type { ExcludedField } from './nativePort';
import type { SyncTarget, UnmappedField } from './SyncTarget';
import { resolveFieldMap } from './SyncTarget';
import type { NativeLinkDocument } from './nativeLink';

/** The mapping for one run: field IDs to remote field IDs, plus everything that could not be mapped, by name. */
export type NativeMapping = {
	readonly fieldMap: Readonly<Record<string, string>>;
	readonly unmapped: readonly UnmappedField[];
	/** The synced fields, as the engine sees them. Passed through so the run uses one list, not two. */
	readonly fields: readonly ResolvedField[];
};

export type NativeRunInput = {
	readonly target: SyncTarget;
	readonly port: NativeSyncPort;
	readonly document: NativeLinkDocument;
	readonly direction: SyncDirection;
	readonly choices?: ResolutionBook | undefined;
	/** Injected so a test can fix the stamp; the default is the wall clock. */
	readonly now?: (() => string) | undefined;
};

export type NativeRunResult = {
	readonly report: SyncReport;
	/** The link to save. Identical to the input except for the mapping, the snapshot and the stamps. */
	readonly document: NativeLinkDocument;
	/** Fields that were never part of the sync, with the reason, for the panel. */
	readonly excluded: readonly ExcludedField[];
};

/**
 * The field mapping for this run, computed from the remote table's current description. Matching is by display name,
 * a stored mapping (by field ID) wins when its remote field still exists, and the output is keyed by field ID.
 */
export async function mappingFor(
	target: SyncTarget,
	port: NativeSyncPort,
	document: NativeLinkDocument,
): Promise<NativeMapping> {
	const fields = port.syncFields();
	const nameOf = (fieldId: string): string => port.columnNameOf(fieldId) ?? fieldId;

	// Display names that appear more than once cannot be matched by name. They are reported, never guessed at.
	const counts = new Map<string, number>();
	for (const field of fields) {
		const name = nameOf(field.definition.name);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const idByName = new Map<string, string>();
	const ambiguous: UnmappedField[] = [];
	for (const field of fields) {
		const name = nameOf(field.definition.name);
		if ((counts.get(name) ?? 0) > 1) {
			ambiguous.push({ side: 'local', name });
		} else {
			idByName.set(name, field.definition.name);
		}
	}

	const existingByName: Record<string, string> = {};
	for (const [fieldId, remoteId] of Object.entries(document.fieldMap)) {
		const name = port.columnNameOf(fieldId);
		if (name !== null && idByName.has(name)) {
			existingByName[name] = remoteId;
		}
	}

	const description = await target.describe();
	const resolved = resolveFieldMap([...idByName.keys()], description.fields, existingByName);

	const fieldMap: Record<string, string> = {};
	for (const [name, remoteId] of Object.entries(resolved.map)) {
		const fieldId = idByName.get(name);
		if (fieldId !== undefined) {
			fieldMap[fieldId] = remoteId;
		}
	}
	return { fieldMap, unmapped: [...resolved.unmapped, ...ambiguous], fields };
}

/** One run: map, pull and/or push through the engine, then return the link to save. Nothing is saved here. */
export async function runNativeSync(input: NativeRunInput): Promise<NativeRunResult> {
	const { target, port, document, direction } = input;
	const mapping = await mappingFor(target, port, document);
	const since = direction === 'push' ? null : document.lastPulledAt;

	const report = await runSync({
		target,
		local: port,
		fields: mapping.fields,
		fieldMap: mapping.fieldMap,
		recordMap: document.rowMap,
		snapshot: document.snapshot,
		direction,
		...(input.choices === undefined ? {} : { choices: input.choices }),
		// A complete review must be able to apply; the legacy gate would hold it forever (see `runSync`).
		conflictGate: 'choices',
		since,
		unmapped: mapping.unmapped,
	});

	const stamp = (input.now ?? (() => new Date().toISOString()))();
	const next: NativeLinkDocument = {
		...document,
		fieldMap: mapping.fieldMap,
		snapshot: report.snapshot,
		// Only a run that actually read moves the cursor, and only a run that actually pushed stamps the push.
		lastPulledAt: report.pull === null ? document.lastPulledAt : stamp,
		lastPushedAt: report.push?.pushedAt ?? document.lastPushedAt,
	};
	return { report, document: next, excluded: port.excludedFields() };
}

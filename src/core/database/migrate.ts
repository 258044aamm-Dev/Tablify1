/**
 * Internal schema versioning — R1 step 8.
 *
 * `.tablify` carries its own document version, and this module is the only place a file may be
 * upgraded: {@link parseAndMigrate} parses, validates, and applies pure `vN → vN+1` steps until the
 * document speaks the version this build writes. The rules the guide fixes:
 *
 *   - **Migrations are pure and deterministic.** A step takes a document and returns a new one plus
 *     warnings; nothing mutates its input, so a caller keeps the original model and a failure is
 *     reproducible from the file alone.
 *   - **A newer file is never migrated down.** `readDocument` refuses it with the version named
 *     before this module ever sees it; the refusal branch here repeats that posture for hand-built
 *     models, so the rule holds no matter how a document was made.
 *   - **This migrator knows `.tablify` only.** There is no importer from `.base`, Markdown
 *     frontmatter, or `.tabula`, and R1 ships no sync-link metadata migration — those are separate
 *     problems with separate phases.
 *
 * Version 1 is the first frozen schema, so the registry below is empty — but the engine is real,
 * and its semantics are tested with a stand-in step. The first real migration should not also be
 * the first test of the machinery that runs it.
 */
import type { DocumentLoad, LoadError, LoadWarning } from './result';
import type { DatabaseDocument } from './schema';
import { DOCUMENT_VERSION } from './schema';
import { parseDocument } from './envelope';

/** A document produced by one migration step, with anything the step wants to say about it. */
export interface MigratedDocument {
	readonly document: DatabaseDocument;
	readonly warnings: readonly LoadWarning[];
}

/** One pure upgrade step: `vN → vN+1`, claiming exactly one version. */
export interface DocumentMigration {
	readonly from: number;
	readonly to: number;
	readonly apply: (document: DatabaseDocument) => MigratedDocument;
}

/**
 * Every migration this build ships, keyed by the version each one upgrades *from*.
 *
 * Empty by construction: version 1 is the first schema this format has ever had, so there is
 * nothing older to upgrade. When a version 2 schema lands, its `1 → 2` step goes here — beside its
 * fixtures and its own test — and `parseAndMigrate` starts using it without changing its callers.
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

/** The refusal a version this build cannot reach produces, whichever way it is unreachable. */
function refuse(code: string, message: string): DocumentLoad {
	const error: LoadError = { code, message, path: '$.version' };
	return { ok: false, errors: [error], rawTextPreserved: true };
}

/**
 * Upgrade a document to the version this build writes, or refuse with the reason.
 *
 * The `migrations` parameter exists for tests and for a future phase that composes registries; in
 * production it is the default {@link DOCUMENT_MIGRATIONS}. The walk is deterministic: it always
 * starts from the document's own declared version and always takes the one step that claims it.
 */
export function migrateDocument(
	document: DatabaseDocument,
	migrations: readonly DocumentMigration[] = DOCUMENT_MIGRATIONS,
): DocumentLoad {
	if (document.version > DOCUMENT_VERSION) {
		return refuse(
			'unsupported-version',
			`This file uses .tablify format version ${String(document.version)}, and this build writes version ${String(DOCUMENT_VERSION)}. The file is not opened for writing and is never migrated down.`,
		);
	}

	let current = document;
	const warnings: LoadWarning[] = [];
	while (current.version < DOCUMENT_VERSION) {
		const step = migrations.find((candidate) => candidate.from === current.version);
		if (step === undefined) {
			return refuse(
				'missing-migration',
				`This build has no migration from .tablify format version ${String(current.version)}; the file is not opened for writing.`,
			);
		}
		if (step.to !== step.from + 1) {
			return refuse(
				'invalid-migration',
				`The migration from version ${String(step.from)} claims to reach version ${String(step.to)}, and a migration step must reach exactly the next version.`,
			);
		}
		const migrated = step.apply(current);
		if (migrated.document.version !== step.to) {
			return refuse(
				'invalid-migration',
				`The migration from version ${String(step.from)} produced a document that declares version ${String(migrated.document.version)} instead of ${String(step.to)}.`,
			);
		}
		warnings.push(...migrated.warnings, {
			code: 'migrated',
			message: `Upgraded this file from .tablify format version ${String(step.from)} to ${String(step.to)}.`,
			path: '$.version',
		});
		current = migrated.document;
	}

	return { ok: true, document: current, warnings };
}

/**
 * The host's entry point: parse and validate, then upgrade when the file is older.
 *
 * This is `parseDocument` plus the version walk — the same refusal shape, the same collected
 * errors, and never a throw for bad input. A file this build cannot read is refused exactly as the
 * parser refuses it, before any migration is considered. A file that already speaks this build's
 * version comes back exactly as `parseDocument` returned it, **load findings included**: the
 * document-wide link and option scans are part of what a load means, and a host that took the
 * migration path must not silently lose them.
 */
export function parseAndMigrate(text: string): DocumentLoad {
	const loaded = parseDocument(text);
	if (!loaded.ok) {
		return loaded;
	}
	if (loaded.document.version >= DOCUMENT_VERSION) {
		return loaded;
	}
	const migrated = migrateDocument(loaded.document);
	if (!migrated.ok) {
		return migrated;
	}
	return {
		ok: true,
		document: migrated.document,
		warnings: [...loaded.warnings, ...migrated.warnings],
	};
}

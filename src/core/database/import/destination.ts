/**
 * Destination choices for importing a spreadsheet into a native database.
 *
 * This is deliberately a choice contract, not a write plan: it names the destination and the mapping policy, but
 * does not resolve fields, generate IDs, describe cell conversions, or authorize destructive changes. Those facts
 * are derived and confirmed in the exact plan before apply (ADR-0007).
 */

/** One source column explicitly mapped to a stable native field ID. */
export type ExplicitImportField = {
	readonly sourceColumn: number;
	readonly fieldId: string;
};

/** How imported columns are matched to fields in an existing table. */
export type ImportFieldMapping =
	| {
			/** Suggest header/name matches for preview. This choice is not confirmation to apply those matches. */
			readonly kind: 'suggest-by-name';
	  }
	| {
			/** The user explicitly mapped source columns to stable field IDs. */
			readonly kind: 'field-ids';
			readonly fields: readonly ExplicitImportField[];
	  };

/** How a replace import identifies existing rows. No key means append; position is never used as identity. */
export type ReplaceRowMatch =
	| { readonly kind: 'append' }
	| {
			readonly kind: 'field-id';
			readonly sourceColumn: number;
			readonly fieldId: string;
	  };

/**
 * One of the three native-table destinations.
 *
 * Replacing follows ADR-0007: it replaces values in columns supplied by the import, not the schema wholesale.
 * Fields absent from the import are retained unless `removeAbsentFields` is explicitly selected; without a mapped
 * row key, imported rows append. Unmatched existing rows are retained, and row IDs are never reused by position.
 */
export type DatabaseImportDestination =
	| {
			readonly kind: 'create';
			readonly tableName: string;
	  }
	| {
			readonly kind: 'append';
			readonly tableId: string;
			readonly fieldMapping: ImportFieldMapping;
	  }
	| {
			readonly kind: 'replace';
			readonly tableId: string;
			readonly fieldMapping: ImportFieldMapping;
			readonly rowMatch: ReplaceRowMatch;
			/** Defaults to false in the wizard; removing unprovided fields is a separate explicit choice. */
			readonly removeAbsentFields: boolean;
	  };

/** True only for a name-suggestion policy; the plan must show the proposed matches and require confirmation. */
export function requiresImportMappingConfirmation(destination: DatabaseImportDestination): boolean {
	return destination.kind !== 'create' && destination.fieldMapping.kind === 'suggest-by-name';
}

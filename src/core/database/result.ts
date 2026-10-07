/**
 * The vocabulary of loading a `.tablify` document: what the guide (R1 step 7) calls the
 * parser/validator result types.
 *
 * Three rules the whole codec lives by:
 *
 *   1. **Ordinary bad input is a value, not an exception.** Nothing here throws for a malformed
 *      file; a refusal is a `{ ok: false }` result with one entry per problem, so a repair screen
 *      can show all of them at once.
 *   2. **Errors are collected, not fail-fast.** `readDocument` keeps going after the first problem
 *      so `errors` describes the file, not just its first wound.
 *   3. **The raw text is never the parser's to destroy.** On refusal the caller still holds the
 *      original text; `rawTextPreserved` is the machine-readable way of saying so (R1 step 7:
 *      "Error results must retain the original bytes/text outside the pure parser").
 */
import type { DatabaseDocument } from './schema';

/** One reason a document was refused. `path` is a JSONPath-shaped location (`$.tables[0].id`). */
export interface LoadError {
	readonly code: string;
	readonly message: string;
	readonly path: string;
}

/** One finding that does not stop the load — preserved data the user should know about. */
export interface LoadWarning {
	readonly code: string;
	readonly message: string;
	readonly path: string;
}

/** The outcome of reading a document: usable, or refused with every reason and the text kept. */
export type DocumentLoad =
	| {
			readonly ok: true;
			readonly document: DatabaseDocument;
			readonly warnings: readonly LoadWarning[];
	  }
	| {
			readonly ok: false;
			readonly errors: readonly LoadError[];
			readonly rawTextPreserved: true;
	  };

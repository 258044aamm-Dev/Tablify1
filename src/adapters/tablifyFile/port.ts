/**
 * The file port — the one seam between the session and a real vault.
 *
 * Everything the repository needs from a host is here and nothing else: read, create, replace,
 * existence, and a subscription for change events. The unit tests use an in-memory fake
 * (`tests/fakes/tablifyFile.ts`); the real adapter (`vaultPort.ts`) wraps the Obsidian `Vault` and
 * is the only file in this folder that imports the `obsidian` package.
 *
 * Two rules the interface makes explicit:
 *
 *   - **`write` is a full replace through a notifying API.** The adapter maps it to `Vault.modify`
 *     (or `Vault.process`), never to `Vault.adapter.write` — a raw adapter write does not notify the
 *     vault, and a `.tablify` file whose own plugin bypasses the change events is a file two panes
 *     can disagree about (ADR-0005). Whether the notification actually fires is the probe kit's
 *     question (`probes/r2-file-view/`), not an assumption of this file.
 *   - **Events carry no text.** A subscriber reads when it decides to; the port never hands out a
 *     revision it has not read, so no consumer can accidentally trust a stale snapshot.
 */

/** What happened to a file the port watches. `renamed` carries where it came from. */
export type FilePortEvent =
	| { readonly kind: 'changed'; readonly path: string }
	| { readonly kind: 'created'; readonly path: string }
	| { readonly kind: 'renamed'; readonly path: string; readonly previousPath: string }
	| { readonly kind: 'deleted'; readonly path: string };

/** A file the port can address. Missing files are reported by `read` as a refusal, not a throw. */
export interface FilePort {
	/** The file's text. Rejects when the file does not exist or cannot be read. */
	read(path: string): Promise<string>;
	/** True when the path exists as a file. */
	exists(path: string): Promise<boolean>;
	/** Create a new file. Rejects when something already exists at the path. */
	create(path: string, text: string): Promise<void>;
	/** Replace a file's whole contents through a notifying API. Rejects on failure. */
	write(path: string, text: string): Promise<void>;
	/** Watch vault changes. The returned function unsubscribes. */
	subscribe(listener: (event: FilePortEvent) => void): () => void;
}

/** The refusal a port produces when the file it was asked about is not there. */
export class MissingFileError extends Error {
	readonly path: string;
	constructor(path: string) {
		super(`There is no file at "${path}".`);
		this.name = 'MissingFileError';
		this.path = path;
	}
}

/**
 * An in-memory `FilePort` with a write log and hand-cranked vault events.
 *
 * The session's job is telling its own writes apart from someone else's, so the fake makes both
 * visible: `write()` mutates the map and emits `changed` **synchronously, before it resolves** — the
 * ordering that catches a session which forgets to guard an in-flight write — while
 * `simulateExternalChange` is the other party (Sync, another editor, a second pane) touching the
 * file without the session asking.
 */
import type { FilePort, FilePortEvent } from '../../src/adapters/tablifyFile/port';
import { MissingFileError } from '../../src/adapters/tablifyFile/port';

export interface FakeVaultPort extends FilePort {
	/** The vault's files, by path. Reachable so a test can assert the bytes that landed. */
	readonly files: Map<string, string>;
	/** Every path `write()` replaced, in order — the write-count evidence. */
	readonly writes: readonly string[];
	/** When true, the next `write()` rejects with a plain error (the "write failed" path). */
	failNextWrite: boolean;
	/** Someone else edits the file: text replaced, `changed` emitted, no write recorded. */
	simulateExternalChange(path: string, text: string): void;
	/** Someone else renames the file: `renamed` emitted, write log untouched. */
	simulateRename(oldPath: string, newPath: string): void;
	/** Someone else deletes the file: `deleted` emitted. */
	simulateDelete(path: string): void;
	/** How many subscribers are still attached — the dispose-leak evidence. */
	listenerCount(): number;
}

export function createFakePort(initial: Readonly<Record<string, string>> = {}): FakeVaultPort {
	const files = new Map<string, string>(Object.entries(initial));
	const writes: string[] = [];
	const listeners = new Set<(event: FilePortEvent) => void>();

	const emit = (event: FilePortEvent): void => {
		for (const listener of listeners) {
			listener(event);
		}
	};

	const port: FakeVaultPort = {
		files,
		writes,
		failNextWrite: false,
		async read(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				throw new MissingFileError(path);
			}
			return text;
		},
		async exists(path: string): Promise<boolean> {
			return files.has(path);
		},
		async create(path: string, text: string): Promise<void> {
			if (files.has(path)) {
				throw new Error(`A file already exists at "${path}".`);
			}
			files.set(path, text);
			emit({ kind: 'created', path });
		},
		async write(path: string, text: string): Promise<void> {
			if (port.failNextWrite) {
				port.failNextWrite = false;
				throw new Error('The disk said no.');
			}
			if (!files.has(path)) {
				throw new MissingFileError(path);
			}
			files.set(path, text);
			writes.push(path);
			emit({ kind: 'changed', path });
		},
		subscribe(listener: (event: FilePortEvent) => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		simulateExternalChange(path: string, text: string): void {
			files.set(path, text);
			emit({ kind: 'changed', path });
		},
		simulateRename(oldPath: string, newPath: string): void {
			const text = files.get(oldPath);
			if (text === undefined) {
				throw new MissingFileError(oldPath);
			}
			files.delete(oldPath);
			files.set(newPath, text);
			emit({ kind: 'renamed', path: newPath, previousPath: oldPath });
		},
		simulateDelete(path: string): void {
			files.delete(path);
			emit({ kind: 'deleted', path });
		},
		listenerCount(): number {
			return listeners.size;
		},
	};
	return port;
}

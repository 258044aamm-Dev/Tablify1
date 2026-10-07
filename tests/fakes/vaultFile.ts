/**
 * An in-memory vault that satisfies `VaultSlice` — the double for `vaultPort.ts` and for anything
 * that hands the port a real-ish vault (the R2 file view's tests).
 *
 * It is deliberately a *file* vault, not a frontmatter one: R2's world is text in, text out, and the
 * Bases-era fake (`tests/fakes/vault.ts`) models properties, which is a different question. Two
 * behaviours are modelled because the port's tests depend on them:
 *
 *   - `create` refuses a path that is already taken, like `Vault.create` does;
 *   - `process` re-reads, applies the callback and stores the result, and emits `modify` **before it
 *     resolves** — the ordering that catches a session which fails to recognise its own write.
 *
 * Everything is synchronous under `async` signatures, so a test never needs a real timer. Files are
 * built by `makeTFile`: the pinned typings declare `TFile` with a no-argument constructor and public
 * `path`/`basename`/`extension` fields, so a test can assemble one the same way the real class does.
 */
import type { EventRef, TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';

import type { VaultSlice } from '../../src/adapters/tablifyFile/vaultPort';

type EventName = 'create' | 'modify' | 'delete' | 'rename';

/** A `TFile` for `path`, filled in the way the real class fills itself. */
export function makeTFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split('/').pop() ?? path;
	const dot = file.name.lastIndexOf('.');
	file.extension = dot === -1 ? '' : file.name.slice(dot + 1);
	file.basename = dot === -1 ? file.name : file.name.slice(0, dot);
	return file;
}

export interface FakeVaultFile extends VaultSlice {
	/** The vault's files, by path. Reachable so a test can assert the bytes that landed. */
	readonly files: Map<string, string>;
	/** Every path `process()` replaced, in order — the write-count evidence. */
	readonly writes: readonly string[];
	/** Someone else edits the file: text replaced, `modify` emitted, no write recorded. */
	simulateExternalModify(path: string, text: string): void;
	/** Someone else renames the file: `rename` emitted, write log untouched. */
	simulateRename(oldPath: string, newPath: string): void;
	/** Someone else deletes the file: `delete` emitted. */
	simulateDelete(path: string): void;
	/** Someone else creates a file: `create` emitted, nothing recorded as a write. */
	simulateCreate(path: string, text: string): void;
	/** How many listeners the vault still has — the dispose-leak evidence. */
	listenerCount(): number;
}

type Listener = (file: TAbstractFile, oldPath: string) => void;

export function createFakeVaultFile(initial: Readonly<Record<string, string>> = {}): FakeVaultFile {
	const files = new Map<string, string>(Object.entries(initial));
	const writes: string[] = [];
	const listeners = new Map<EventName, Set<Listener>>();
	const refs = new Map<EventRef, { readonly name: EventName; readonly listener: Listener }>();

	const emit = (name: EventName, file: TAbstractFile, oldPath = ''): void => {
		const set = listeners.get(name);
		if (set === undefined) {
			return;
		}
		for (const listener of set) {
			listener(file, oldPath);
		}
	};

	const vault: FakeVaultFile = {
		files,
		writes,
		getAbstractFileByPath(path: string): TAbstractFile | null {
			return files.has(path) ? makeTFile(path) : null;
		},
		read(file: TFile): Promise<string> {
			const text = files.get(file.path);
			if (text === undefined) {
				return Promise.reject(new Error(`no file at "${file.path}"`));
			}
			return Promise.resolve(text);
		},
		create(path: string, data: string): Promise<TFile> {
			if (files.has(path)) {
				return Promise.reject(new Error(`"${path}" already exists`));
			}
			files.set(path, data);
			emit('create', makeTFile(path));
			return Promise.resolve(makeTFile(path));
		},
		process(file: TFile, fn: (data: string) => string): Promise<string> {
			const before = files.get(file.path);
			if (before === undefined) {
				return Promise.reject(new Error(`no file at "${file.path}"`));
			}
			const after = fn(before);
			files.set(file.path, after);
			writes.push(file.path);
			emit('modify', makeTFile(file.path));
			return Promise.resolve(after);
		},
		on(name: EventName, callback: Listener): EventRef {
			const set = listeners.get(name) ?? new Set<Listener>();
			listeners.set(name, set);
			set.add(callback);
			const ref: EventRef = {};
			refs.set(ref, { name, listener: callback });
			return ref;
		},
		offref(ref: EventRef): void {
			const known = refs.get(ref);
			if (known === undefined) {
				return;
			}
			refs.delete(ref);
			listeners.get(known.name)?.delete(known.listener);
		},
		simulateExternalModify(path: string, text: string): void {
			files.set(path, text);
			emit('modify', makeTFile(path));
		},
		simulateRename(oldPath: string, newPath: string): void {
			const text = files.get(oldPath);
			if (text === undefined) {
				throw new Error(`no file at "${oldPath}"`);
			}
			files.delete(oldPath);
			files.set(newPath, text);
			emit('rename', makeTFile(newPath), oldPath);
		},
		simulateDelete(path: string): void {
			files.delete(path);
			emit('delete', makeTFile(path));
		},
		simulateCreate(path: string, text: string): void {
			files.set(path, text);
			emit('create', makeTFile(path));
		},
		listenerCount(): number {
			let total = 0;
			for (const set of listeners.values()) {
				total += set.size;
			}
			return total;
		},
	};
	return vault;
}

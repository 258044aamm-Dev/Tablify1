/**
 * The Obsidian `Vault` behind the file port — the one file in this folder that knows what a `TFile`
 * is. Everything above it (`session.ts`, `queue.ts`, `registry.ts`) is host-free and tested against
 * the in-memory fake; this adapter is the thin translation, and its tests use a vault double rather
 * than the real app.
 *
 * The API mapping, stated where it can be checked against the pinned typings (obsidian@1.13.1):
 *
 *   - `read`      → `Vault.read` (:7412); a path that is not a `TFile` is a `MissingFileError`, so the
 *                   session's "the file is gone" path is the same for a deleted file and a typo.
 *   - `write`     → `Vault.process` (:7510, `@since 1.1.0` — older than the 1.13.0 floor). It is the
 *                   documented atomic read-modify-write and it notifies the vault, which is what
 *                   `port.ts` requires. `Vault.adapter.write` is never used: a raw adapter write does
 *                   not notify, and a `.tablify` file whose own plugin bypasses change events is a
 *                   file two panes can disagree about (ADR-0005).
 *   - `create`    → `Vault.create` (:7386), which refuses an existing path on its own; the port
 *                   refuses first so the error is a `RegistryFailure` rather than a thrown string.
 *   - `subscribe` → `Vault.on` for create/modify/delete/rename (:7558–:7576) and `Vault.offref`
 *                   (:2824) on the way out. Events carry the path only; the session reads when it
 *                   decides to, so no revision is ever trusted from an event.
 *
 * Whether every one of those APIs behaves as documented **on a real device** is exactly what the R2
 * probe kit measures (`probes/r2-file-view/`, `docs/manual-test-log.md`). This file is written to the
 * typings and the guides; it is not evidence about the host.
 */
import type { EventRef, TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';

import type { FilePort, FilePortEvent } from './port';
import { MissingFileError } from './port';

/**
 * The slice of `Vault` this port uses — stated as its own interface so the adapter is written against
 * exactly what it needs, the double in `tests/fakes/vaultFile.ts` implements it structurally, and a
 * real `Vault` is assignable to it (`main.ts` passes `this.app.vault`; the compiler proves it).
 */
export interface VaultSlice {
	getAbstractFileByPath(path: string): TAbstractFile | null;
	read(file: TFile): Promise<string>;
	create(path: string, data: string): Promise<TFile>;
	process(file: TFile, fn: (data: string) => string): Promise<string>;
	on(
		name: 'create' | 'modify' | 'delete' | 'rename',
		callback: (file: TAbstractFile, oldPath: string) => unknown,
		ctx?: unknown,
	): EventRef;
	offref(ref: EventRef): void;
}

/** Resolve a path to the `TFile` at it, or throw the port's own missing-file refusal. */
function fileAt(vault: VaultSlice, path: string): TFile {
	const file: TAbstractFile | null = vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new MissingFileError(path);
	}
	return file;
}

/** Wrap a live vault as a `FilePort`. The vault is not owned: unsubscribing is the only teardown. */
export function createVaultPort(vault: VaultSlice): FilePort {
	return {
		async read(path: string): Promise<string> {
			return vault.read(fileAt(vault, path));
		},
		exists(path: string): Promise<boolean> {
			return Promise.resolve(vault.getAbstractFileByPath(path) !== null);
		},
		async create(path: string, text: string): Promise<void> {
			if (vault.getAbstractFileByPath(path) !== null) {
				throw new Error(`There is already something at "${path}".`);
			}
			await vault.create(path, text);
		},
		async write(path: string, text: string): Promise<void> {
			await vault.process(fileAt(vault, path), () => text);
		},
		subscribe(listener: (event: FilePortEvent) => void): () => void {
			const refs: EventRef[] = [
				vault.on('create', (file) => {
					listener({ kind: 'created', path: file.path });
				}),
				vault.on('modify', (file) => {
					listener({ kind: 'changed', path: file.path });
				}),
				vault.on('delete', (file) => {
					listener({ kind: 'deleted', path: file.path });
				}),
				vault.on('rename', (file, oldPath) => {
					listener({ kind: 'renamed', path: file.path, previousPath: oldPath });
				}),
			];
			return () => {
				for (const ref of refs) {
					vault.offref(ref);
				}
			};
		},
	};
}

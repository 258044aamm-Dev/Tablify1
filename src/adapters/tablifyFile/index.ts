/**
 * `.tablify` file I/O — R2's adapter folder, and the only place a document meets a disk.
 *
 * The direction of the imports is the point: `session.ts` and `port.ts` are host-free (tests drive
 * them through `tests/fakes/tablifyFile.ts`), and the future `vaultPort.ts` wraps the Obsidian
 * `Vault` behind the same `FilePort` so nothing else in the folder has to know what a `TFile` is.
 * R2 step 4's write queue and step 5's pane registry plug into this boundary too.
 */
export type { FilePort, FilePortEvent } from './port';
export type { CloseResult, QueueScheduler, WriteQueue, WriteQueueOptions } from './queue';
export { createWriteQueue } from './queue';
export type {
	DatabaseHandle,
	RegistryFailure,
	RegistryResult,
	SessionRegistry,
	SessionRegistryOptions,
} from './registry';
export { createSessionRegistry } from './registry';
export { MissingFileError } from './port';
export { detectRevision } from './revision';
export type {
	DatabaseSession,
	DispatchRefusalCode,
	DispatchResult,
	FlushResult,
	OpenFailure,
	OpenResult,
	SessionChange,
	SessionListener,
	SessionState,
} from './session';
export { openDatabase } from './session';

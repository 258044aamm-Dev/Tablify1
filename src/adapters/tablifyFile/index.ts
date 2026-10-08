/**
 * `.tablify` file I/O — R2's adapter folder, and the only place a document meets a disk.
 *
 * The direction of the imports is the point: `port.ts`, `revision.ts`, `session.ts`, `queue.ts` and
 * `registry.ts` are host-free (tests drive them through `tests/fakes/tablifyFile.ts`), and
 * `vaultPort.ts` — the one file here that imports `obsidian` — wraps a live `Vault` behind the same
 * `FilePort`, so nothing else in the folder has to know what a `TFile` is.
 */
export type { FilePort, FilePortEvent } from './port';
export type { CloseResult, QueueScheduler, WriteQueue, WriteQueueOptions } from './queue';
export { createWriteQueue } from './queue';
export type {
	DatabaseStore,
	DatabaseStoreOptions,
	DatabaseStoreSnapshot,
	TableSelectionResult,
} from './databaseStore';
export { createDatabaseStore } from './databaseStore';
export type {
	DatabaseHandle,
	RegistryFailure,
	RegistryResult,
	SessionRegistry,
	SessionRegistryOptions,
} from './registry';
export { createSessionRegistry } from './registry';
export type { VaultSlice } from './vaultPort';
export { createVaultPort } from './vaultPort';
export { MissingFileError } from './port';
export { detectRevision } from './revision';
export type {
	DatabaseSession,
	DispatchRefusalCode,
	DispatchResult,
	FlushResult,
	HistoryResult,
	OpenFailure,
	OpenResult,
	SessionChange,
	SessionListener,
	SessionState,
} from './session';
export { openDatabase } from './session';
export type { DatabaseHistorySummary } from '../../core/database/history';

/**
 * The vault port — the seam between the session and Obsidian's vault, tested against the double.
 *
 * Each test names the API the adapter is supposed to use, so the mapping is checkable rather than
 * asserted by reading the source: reads go through `Vault.read`, writes through the notifying
 * `Vault.process`, creations through `Vault.create`, and the four vault events become the four port
 * events. What the real app does with those calls on a device is the probe kit's question; what this
 * file fixes is that the plugin asks the documented API and nothing else.
 */
import { describe, expect, it } from 'vitest';

import { MissingFileError } from '../../src/adapters/tablifyFile/port';
import type { FilePortEvent } from '../../src/adapters/tablifyFile/port';
import { createVaultPort } from '../../src/adapters/tablifyFile/vaultPort';
import { createFakeVaultFile } from '../fakes/vaultFile';

const PATH = 'Databases/Studio.tablify';

describe('reading and existence', () => {
	it('reads the text the vault holds', async () => {
		const vault = createFakeVaultFile({ [PATH]: 'the text' });
		const port = createVaultPort(vault);
		await expect(port.read(PATH)).resolves.toBe('the text');
		await expect(port.exists(PATH)).resolves.toBe(true);
	});

	it('refuses a path with no file at it, as a missing file rather than a crash', async () => {
		const vault = createFakeVaultFile();
		const port = createVaultPort(vault);
		await expect(port.exists(PATH)).resolves.toBe(false);
		await expect(port.read(PATH)).rejects.toBeInstanceOf(MissingFileError);
	});
});

describe('creating', () => {
	it('creates a file that is not there', async () => {
		const vault = createFakeVaultFile();
		const port = createVaultPort(vault);
		await port.create(PATH, 'brand new');
		expect(vault.files.get(PATH)).toBe('brand new');
	});

	it('refuses to create over something that already exists', async () => {
		const vault = createFakeVaultFile({ [PATH]: 'the original' });
		const port = createVaultPort(vault);
		await expect(port.create(PATH, 'clobber')).rejects.toThrow(/already something/);
		expect(vault.files.get(PATH)).toBe('the original');
	});
});

describe('writing', () => {
	it('replaces through the notifying API, and the vault says the file changed', async () => {
		const vault = createFakeVaultFile({ [PATH]: 'old text' });
		const port = createVaultPort(vault);
		const events: FilePortEvent[] = [];
		const unsubscribe = port.subscribe((event) => {
			events.push(event);
		});
		await port.write(PATH, 'new text');
		expect(vault.files.get(PATH)).toBe('new text');
		expect(vault.writes).toEqual([PATH]);
		expect(events).toEqual([{ kind: 'changed', path: PATH }]);
		unsubscribe();
	});

	it('refuses to write a file that is gone', async () => {
		const vault = createFakeVaultFile();
		const port = createVaultPort(vault);
		await expect(port.write(PATH, 'nowhere')).rejects.toBeInstanceOf(MissingFileError);
		expect(vault.writes).toEqual([]);
	});
});

describe('events', () => {
	it('maps create, modify, delete and rename to the port events', () => {
		const vault = createFakeVaultFile();
		const port = createVaultPort(vault);
		const events: FilePortEvent[] = [];
		port.subscribe((event) => {
			events.push(event);
		});
		vault.simulateCreate(PATH, 'x');
		vault.simulateExternalModify(PATH, 'y');
		vault.simulateRename(PATH, 'Databases/Moved.tablify');
		vault.simulateDelete('Databases/Moved.tablify');
		expect(events).toEqual([
			{ kind: 'created', path: PATH },
			{ kind: 'changed', path: PATH },
			{ kind: 'renamed', path: 'Databases/Moved.tablify', previousPath: PATH },
			{ kind: 'deleted', path: 'Databases/Moved.tablify' },
		]);
	});

	it('stops delivering after unsubscribe, and leaves no listener behind', () => {
		const vault = createFakeVaultFile({ [PATH]: 'x' });
		const port = createVaultPort(vault);
		const events: FilePortEvent[] = [];
		const unsubscribe = port.subscribe((event) => {
			events.push(event);
		});
		expect(vault.listenerCount()).toBe(4);
		vault.simulateExternalModify(PATH, 'y');
		unsubscribe();
		vault.simulateExternalModify(PATH, 'z');
		expect(events).toEqual([{ kind: 'changed', path: PATH }]);
		expect(vault.listenerCount()).toBe(0);
	});
});

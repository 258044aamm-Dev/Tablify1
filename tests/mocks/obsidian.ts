/**
 * Runtime double for the `obsidian` package.
 *
 * The published package is types-only — its `main` field is an empty string — so nothing can import
 * it at runtime. Vitest resolves `obsidian` to this file (see `vitest.config.ts`), while TypeScript
 * keeps using the real `obsidian.d.ts` for every type. Only the surface plugin code actually touches
 * is implemented here; every addition must be justified by a test that needs it.
 */

/** Every `new Notice(message)` in a test run, in order. Reset it in `beforeEach` when asserting on it. */
export const noticeLog: string[] = [];

export class Notice {
	constructor(message: string) {
		noticeLog.push(message);
	}
}

export class Plugin {
	manifest: { version: string } = { version: '0.0.0' };

	addCommand(_command: { id: string; name: string; callback: () => void }): void {
		// Command registration is asserted through the receiver the test supplies.
	}

	onload(): void {}
	onunload(): void {}
}

export class PluginSettingTab {}

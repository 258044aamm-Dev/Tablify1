import { Notice, Plugin } from 'obsidian';

/**
 * Tablify's plugin entry point. At this milestone it registers a single command so the whole
 * toolchain — typecheck, lint, test, bundle — runs end to end against real plugin code. The grid,
 * the settings tab and the Bases view registration arrive in later steps.
 */
export default class TablifyPlugin extends Plugin {
	onload(): void {
		this.addCommand({
			id: 'show-version',
			name: 'Show version',
			callback: () => {
				new Notice(`Tablify ${this.manifest.version}`);
			},
		});
	}

	onunload(): void {
		// Nothing to release yet: no timers, no listeners, no open handles.
	}
}

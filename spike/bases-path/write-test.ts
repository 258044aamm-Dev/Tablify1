/**
 * The spike's two write probes, as commands, because a write must never happen by itself.
 *
 * 1. **`change one property`** — prints the path it is about to touch, reads the file as text, runs
 *    `processFrontMatter`, reads the file again, and prints the before/after text. The diff is the point: it
 *    shows whether unknown frontmatter keys, comments, key order and formatting survive.
 * 2. **`call createFileForView`** — calls the sanctioned row-creation path and prints what the promise does.
 *    The declaration says it *displays the new note menu*, so it opens a modal: a human runs it on purpose,
 *    it is never part of a load path.
 *
 * `registerWriteProbes` is called from `main.ts` with the plugin and a getter for the live views, so the
 * commands work whether the grid is open or not.
 */
import { Notice, Plugin } from 'obsidian';
import type { BasesEntry, BasesView, TFile } from 'obsidian';

/** What the probes report back to the console, prefixed like everything else in this folder. */
function log(message: string): void {
	console.log(`[tablify-spike] ${message}`);
}

/** The property the write test changes. It must be the property the report names — nothing else is touched. */
const CHANGED_PROPERTY = 'status';

/** Registers both commands on the spike plugin. */
export function registerWriteProbes(plugin: Plugin, views: () => readonly BasesView[]): void {
	plugin.addCommand({
		id: 'change-one-property',
		name: `Change "${CHANGED_PROPERTY}" on the first row of the spike view`,
		callback: () => {
			const view = views()[0];
			if (view === undefined) {
				new Notice('Open a base with the spike view first.');
				return;
			}
			void changeOneProperty(view);
		},
	});
	plugin.addCommand({
		id: 'call-create-file-for-view',
		name: 'Call createFileForView (opens a modal)',
		callback: () => {
			const view = views()[0];
			if (view === undefined) {
				new Notice('Open a base with the spike view first.');
				return;
			}
			callCreateFileForView(view);
		},
	});
}

/** Writes one property, reporting the file's text before and after so the diff is real, not claimed. */
export async function changeOneProperty(
	view: BasesView,
	property: string = CHANGED_PROPERTY,
): Promise<void> {
	const entry: BasesEntry | undefined = view.data.data[0];
	if (entry === undefined) {
		new Notice('The spike view has no rows to write to.');
		return;
	}
	const file: TFile = entry.file;
	log(`about to change ${file.path} (property "${property}")`);
	const before = await view.app.vault.read(file);
	const value = `spike-${String(Date.now())}`;
	await view.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		// Mutate the object in place: replacing it would drop every key the callback does not know about.
		frontmatter[property] = value;
	});
	const after = await view.app.vault.read(file);
	log(`before:\n${before}`);
	log(`after:\n${after}`);
	log(`changed ${file.path}: "${property}" = ${value}`);
}

/** Calls the sanctioned creation path and reports what comes back. Opens a modal; run it on purpose. */
export function callCreateFileForView(view: BasesView): void {
	log('calling createFileForView("Spike row") — a modal is expected');
	const result = view.createFileForView('Spike row', (frontmatter: Record<string, unknown>) => {
		frontmatter['spikeSeed'] = true;
	});
	void result.then(
		() => {
			log('createFileForView resolved (Promise<void>); check whether a file was created');
		},
		(error: unknown) => {
			log(`createFileForView rejected: ${String(error)}`);
		},
	);
}

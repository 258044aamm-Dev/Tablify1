/**
 * The Bases data-path spike. Throwaway: it proves what `docs/02` §Bases integration claims before a line of
 * the adapter is written, logs what it sees, and is then deleted. It is **not** part of the build — `spike/**`
 * is in `eslint.config.mts`'s ignores and this folder has its own `tsconfig.json` and its own build command.
 *
 * `console.log` is deliberate and confined to this folder: this file's entire job is a labelled trace, and it
 * never ships. What it prints is meant to be pasted into `FINDINGS.md` verbatim.
 *
 * The declarations this file leans on, read from `obsidian.d.ts` @ 1.13.1 (all `@since 1.10.0` unless noted):
 * `Plugin.registerBasesView(viewId, BasesViewRegistration): boolean`; `BasesViewRegistration{name, icon,
 * factory, options?}`; `BasesViewFactory = (controller, containerEl) => BasesView`; `abstract class BasesView
 * extends Component {type, app, config, allProperties, data, onDataUpdated, createFileForView}`;
 * `BasesViewConfig.{get, getOrder, getSort, getDisplayName, set}`; `class BasesEntry {file: TFile;
 * getValue(propertyId): Value | null}`; `class BasesQueryResult {data: BasesEntry[]; groupedData; properties;
 * getSummaryValue}`; `FileManager.processFrontMatter(file, fn, options?)` (`@since 1.4.4`).
 */
import { BasesView, Plugin } from 'obsidian';
import type { BasesEntry, BasesPropertyId, QueryController, TFile, Value } from 'obsidian';
import { registerWriteProbes } from './write-test';

/** The view type under test. Throwaway; the plugin's own id is decided elsewhere. */
const VIEW_TYPE = 'tablify-spike';

/** The property whose raw value, `getValue()` result and constructor name are logged. Edit me to match a base. */
const PROBE_PROPERTY = 'note.status';

/** Every view instance this session created, so the write commands can find one. Module-scope on purpose. */
const live: BasesView[] = [];

export default class SpikePlugin extends Plugin {
	onload(): void {
		const registered: boolean = this.registerBasesView(VIEW_TYPE, {
			name: 'Tablify spike',
			icon: 'lucide-table-2',
			factory: (controller, container) => {
				const view = new SpikeView(controller, container);
				live.push(view);
				return view;
			},
		});
		// Claim: `registerBasesView` returns false when Bases is disabled in the vault.
		log(`registerBasesView returned ${String(registered)}`);
		this.addCommand({
			id: 'report-version',
			name: 'Report Obsidian version and platform',
			callback: () => {
				// Finding, not an oversight: the public API exposes no version. Read it from Settings ▸ About and
				// paste it into FINDINGS.md by hand.
				log('obsidian version: not exposed by the public API — see Settings ▸ About');
				log(`platform: ${navigator.platform} — ${navigator.userAgent}`);
				// Also a finding: whether the Bases core plugin is enabled is only observable as the boolean
				// `registerBasesView` returns at load time, which is logged above.
				log(
					'bases enabled: only observable as the boolean registerBasesView returned at load',
				);
			},
		});
		registerWriteProbes(this, () => live);
	}
}

/** Everything the report needs, each on its own labelled line, exactly as `prompts/step-10` lists it. */
class SpikeView extends BasesView {
	readonly type = VIEW_TYPE;
	/** `BasesView` declares no `containerEl`, so the factory is the only place the container is handed over. */
	private readonly host: HTMLElement;
	private reported = false;

	constructor(controller: QueryController, host: HTMLElement) {
		super(controller);
		this.host = host;
	}

	onDataUpdated(): void {
		if (this.reported) {
			return;
		}
		this.reported = true;
		const box = this.host.getBoundingClientRect();
		const parent = this.host.parentElement?.getBoundingClientRect();
		log(`container: ${sizeOf(box)}   parent: ${sizeOf(parent)}`);
		log(`config.getOrder(): ${JSON.stringify(this.config.getOrder())}`);
		log(`config.getSort(): ${JSON.stringify(this.config.getSort())}`);
		const entries: BasesEntry[] = this.data.data;
		log(`entries: ${String(entries.length)}   first: ${entries[0]?.file.path ?? '(none)'}`);
		this.probe(entries);
		// `createFileForView` is declared `@since 1.10.2`; whether it exists at runtime is the question.
		log(`createFileForView at runtime: ${typeof this.createFileForView}`);
	}

	/** The raw frontmatter value beside what `getValue()` makes of it, and the class it produces. */
	private probe(entries: BasesEntry[]): void {
		const property: BasesPropertyId = PROBE_PROPERTY;
		const name = property.includes('.') ? property.slice(property.indexOf('.') + 1) : property;
		const entry =
			entries.find(
				(candidate) => rawOf(this.app.metadataCache, candidate.file, name) !== undefined,
			) ?? entries[0];
		if (entry === undefined) {
			log(`property ${property}: no entries to read`);
			return;
		}
		const raw: unknown = rawOf(this.app.metadataCache, entry.file, name);
		const value: Value | null = entry.getValue(property);
		log(
			`property ${property}: raw=${JSON.stringify(raw)} getValue=${String(value)} ` +
				`ctor=${value === null ? 'null' : value.constructor.name} ` +
				`displayName=${this.config.getDisplayName(property)}`,
		);
	}
}

/** One labelled line. The spike's whole output format. */
function log(message: string): void {
	console.log(`[tablify-spike] ${message}`);
}

function sizeOf(box: DOMRect | undefined): string {
	return box === undefined
		? '(no parent element)'
		: `${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
}

/**
 * The frontmatter as the metadata cache sees it. `TFile` carries no values in the public types, and
 * `FrontMatterCache` is `[key: string]: any` — this reads it into `unknown` and never trusts the shape.
 */
function rawOf(
	cache: { getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null },
	file: TFile,
	name: string,
): unknown {
	const cached = cache.getFileCache(file);
	if (cached === null || cached.frontmatter === undefined) {
		return undefined;
	}
	return cached.frontmatter[name];
}

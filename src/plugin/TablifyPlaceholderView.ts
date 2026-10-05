import { BasesView, type QueryController } from 'obsidian';

/** The only thing this view says until it is wired to data. */
export const TABLIFY_PLACEHOLDER_TEXT = 'Tablify grid — not wired to data yet';

/**
 * The Bases view the grid will become. For now it proves three things and nothing else: that
 * `registerBasesView` accepts our registration, that the factory receives a usable container, and that
 * the view lifecycle runs. Step 17 replaces the body of this file with the real grid; the registration
 * in `main.ts` — id, name, icon, factory — stays exactly as it is.
 *
 * It deliberately does not read `this.data`: no `BasesEntry`, no frontmatter, no notes.
 */
export class TablifyPlaceholderView extends BasesView {
	/** BasesView.type: abstract string — obsidian.d.ts, @since 1.10.0. Must equal the registered id. */
	readonly type: string;

	/** The element the factory was handed: BasesViewFactory — obsidian.d.ts, @since 1.10.0. */
	readonly containerEl: HTMLElement;

	private readonly messageEl: HTMLElement;

	constructor(controller: QueryController, containerEl: HTMLElement, type: string) {
		// BasesView constructor(controller: QueryController): protected — obsidian.d.ts, @since 1.10.0.
		super(controller);
		this.type = type;
		this.containerEl = containerEl;
		// createDiv({ cls, text }): global DOM augmentation — obsidian.d.ts (Element.createEl,
		// HTMLElement.createDiv), @since 1.4.4.
		this.messageEl = containerEl.createDiv({
			cls: 'tablify-placeholder',
			text: TABLIFY_PLACEHOLDER_TEXT,
		});
	}

	/** BasesView.onDataUpdated(): abstract void — obsidian.d.ts, @since 1.10.0. */
	onDataUpdated(): void {
		// The real grid re-derives from `this.data` here. The placeholder has nothing to update, and
		// saying so in one line is more honest than an empty method with a comment pretending otherwise.
		this.messageEl.setText(TABLIFY_PLACEHOLDER_TEXT);
	}
}

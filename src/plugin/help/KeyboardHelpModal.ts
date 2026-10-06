/**
 * The keyboard reference, as a surface a person can open.
 *
 * It renders `KEY_BINDINGS` and nothing else: one row per binding, the keys on the left, one sentence on the
 * right, no prose paragraphs and no marketing. That is `docs/01`'s own instruction for the help surface, and it
 * is also the only shape that stays true — a hand-written page drifts from the table the moment either changes,
 * and this one is a `for` loop over the single source of truth.
 *
 * **Why an Obsidian `Modal`.** `docs/04` §Accessibility puts it plainly for the conflict and import dialogs —
 * *"Real Obsidian `Modal` (focus trap, Escape, focus restore for free)"* — and the same three reasons apply here:
 * the host already traps focus inside the modal, already binds `Escape` in its own scope, and already knows how
 * to put the surface back the way it found it. Re-implementing that would be three behaviours to get wrong.
 *
 * The focus contract is still applied ({@link openSurface}), because "for free" is the host's *intention*, not a
 * guarantee this plugin can verify from the outside: the opener is recorded here, and on close the contract
 * restores focus if it went nowhere (and leaves it alone if the host — or a surface that opened in the meantime —
 * already dealt with it). Both paths are one line of code and neither can steal focus from a newer surface.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

import { KEY_BINDINGS } from './keyBindings';
import { closeSurface, openSurface, openerOf } from '../../grid/a11y/focusContract';
import type { FocusSurface } from '../../grid/a11y/focusContract';

export class KeyboardHelpModal extends Modal {
	/**
	 * Recorded in the constructor, which runs **before** `open()` moves focus into the modal — the last moment at
	 * which "what had focus" is still answerable.
	 *
	 * The container is `this.contentEl` — where the surface's own focus lives — so "was focus inside the surface
	 * when it closed?" is answerable. The *trap* still belongs to the host's `Modal`; this plugin only needs to
	 * know whether it is the thing losing focus.
	 */
	private readonly surface: FocusSurface;

	constructor(app: App) {
		super(app);
		// Modal constructor(app: App) — obsidian.d.ts, @since 0.14.5. The `document` guard is the same one the
		// composition root keeps for `navigator` (see `main.ts`): the unit project runs in node, where a modal can
		// be constructed and has no opener to record. One guard at the edge beats a class no test can instantiate.
		this.surface = openSurface(
			'help',
			this.contentEl,
			typeof document === 'undefined' ? null : openerOf(document),
		);
	}

	onOpen(): void {
		// Modal.onOpen(): virtual void — obsidian.d.ts, @since 0.9.16; Modal.titleEl / Modal.contentEl are
		// @since 0.14.5; createEl / setText are the DOM augmentations @since 1.4.4.
		this.titleEl.setText('Tablify keyboard');
		const table = this.contentEl.createEl('table', { cls: 'tablify-help-table' });
		const body = table.createEl('tbody');
		for (const binding of KEY_BINDINGS) {
			const row = body.createEl('tr');
			row.createEl('th', {
				cls: 'tablify-help-keys',
				text: binding.keys,
				attr: { scope: 'row' },
			});
			row.createEl('td', { cls: 'tablify-help-does', text: binding.description });
		}
	}

	onClose(): void {
		closeSurface(this.surface);
		this.contentEl.empty();
	}
}

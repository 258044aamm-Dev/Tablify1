/**
 * The shape every dialog in this folder has, in one place: a title, a body, a footer with one primary action, and
 * focus returned to whatever opened it.
 *
 * `docs/04` §Accessibility and §Touch settle the anatomy: a real Obsidian `Modal` (the platform's own focus trap,
 * scoped `Escape`, and the one overlay a person already knows), a title that says what the dialog is *about*
 * ("Field: Status", not "Edit"), a body that explains consequences before offering the destructive action, and a
 * footer whose primary action is the last thing read.
 *
 * **Focus restoration is `focusContract`'s job, not Obsidian's.** `Modal.close()` does not put the focus back
 * anywhere in particular; the surface stack in `src/grid/a11y/focusContract.ts` records the opener and restores
 * only if focus was lost meanwhile, which is the behaviour that survives a dialog opened *from* a menu (the menu
 * closes first, the dialog opens on top, and the focus must end up on the cell, not on `body`).
 *
 * `Element.empty()` is used rather than `innerHTML = ''` (the sample-plugin lint rules ban the latter), and every
 * element is built with `createDiv`/`createEl` so the DOM is never string-concatenated.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

/** What a dialog's body builder is handed: the body element, and a way to close the dialog. */
export type DialogBody = {
	readonly contentEl: HTMLElement;
	readonly close: () => void;
};

export type DialogSpec = {
	/** The dialog's name in the surface stack (`focusContract`), and in the tests' vocabulary. */
	readonly kind: 'grid-popover' | 'menu' | 'dialog' | 'help';
	readonly title: string;
	/** One sentence under the title: what this dialog is for, in the product's own words. */
	readonly subtitle?: string | undefined;
	readonly body: (host: DialogBody) => void;
	/** The footer's primary action. A dialog always has exactly one. */
	readonly primary: { readonly label: string; readonly run: () => void };
	/** A secondary, non-destructive action (Close, Cancel), shown to the left of the primary. */
	readonly secondary?: { readonly label: string; readonly run: () => void } | undefined;
	/** Told when the dialog closes, whatever closed it. The focus contract's own hook. */
	readonly onClosed?: (() => void) | undefined;
};

/** One dialog, built from a {@link DialogSpec}. */
export class GridModal extends Modal {
	private readonly spec: DialogSpec;

	constructor(app: App, spec: DialogSpec) {
		super(app);
		this.spec = spec;
	}

	/**
	 * `Modal.onOpen` (@since 0.9.16): the real `open()` calls this, which is why the tests' double calls it too.
	 * The whole body is built here and nowhere else — `Modal` clears `contentEl` itself on close.
	 */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.spec.title);
		if (this.spec.subtitle !== undefined) {
			contentEl.createDiv({ cls: 'tablify-dlg-sub', text: this.spec.subtitle });
		}
		const body = contentEl.createDiv({ cls: 'tablify-dlg-body' });
		this.spec.body({
			contentEl: body,
			close: () => {
				this.close();
			},
		});
		const foot = contentEl.createDiv({ cls: 'tablify-dlg-foot' });
		if (this.spec.secondary !== undefined) {
			const secondary = foot.createEl('button', {
				cls: 'tablify-dlg-btn',
				text: this.spec.secondary.label,
			});
			secondary.addEventListener('click', () => {
				this.spec.secondary?.run();
				this.close();
			});
		}
		const primary = foot.createEl('button', {
			cls: 'tablify-dlg-btn is-primary',
			text: this.spec.primary.label,
		});
		primary.addEventListener('click', () => {
			this.spec.primary.run();
			this.close();
		});
	}

	/**
	 * `Modal.onClose` (@since 0.9.16). The body is emptied here rather than left to the framework, and the
	 * `onClosed` hook runs **after** the framework has finished with the element, so a listener that asks where
	 * focus went sees the final state rather than a half-closed dialog.
	 */
	onClose(): void {
		this.contentEl.empty();
		this.spec.onClosed?.();
	}
}

/**
 * Builds a dialog **without opening it**. This exists for one reason, and it is the focus contract's: the surface
 * stack has to record the dialog's `contentEl` as the container *before* the dialog takes focus, and the container
 * only exists once the modal has been constructed (`Modal`'s own constructor creates the element; its `open()` is
 * what appends it and calls `onOpen`). So: build, record, open.
 */
export function buildDialog(app: App, spec: DialogSpec): GridModal {
	return new GridModal(app, spec);
}

/** Builds one and opens it, for callers that have no surface to record. */
export function openDialog(app: App, spec: DialogSpec): GridModal {
	const modal = buildDialog(app, spec);
	modal.open();
	return modal;
}

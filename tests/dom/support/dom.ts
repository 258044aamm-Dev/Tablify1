/**
 * The Obsidian DOM helpers a dialog body uses, installed on the **real** element it is handed.
 *
 * Real jsdom elements are what the dialogs build (so an assertion can be a real `querySelectorAll`), and this is the
 * eleven members of `createDiv`/`createSpan`/`toggleClass` the host normally provides. It lives here rather than in
 * the `obsidian` double on purpose: the double's elements are *stubs* that record calls, and a dialog whose body was
 * rendered into a recorder could only be asserted on the recorder. Two test files drive surfaces of their own
 * (`paste-flow` and `export-dialog`), so the helper has one home instead of two copies.
 *
 * It sits under `tests/dom/**` rather than in `tests/mocks/**` for a lint reason worth stating: this file builds
 * elements with `document.createElement`, and `obsidianmd/prefer-create-el` is off for the dom project (Obsidian's
 * `createEl` is *installed by the app*, and jsdom has no app) but not for `tests/mocks/**`, whose double must keep
 * the rule like product code does.
 */
export function augment(el: HTMLElement): HTMLElement {
	const make = (
		tag: string,
		options?: { readonly cls?: string; readonly text?: string },
	): HTMLElement => {
		const child = augment(document.createElement(tag));
		if (options?.cls !== undefined) {
			child.className = options.cls;
		}
		if (options?.text !== undefined) {
			child.textContent = options.text;
		}
		// Appended to the element the helper was called on, which is what makes the body a tree rather than a
		// pile of detached nodes.
		el.append(child);
		return child;
	};
	return Object.assign(el, {
		createEl: (tag: string, options?: { readonly cls?: string; readonly text?: string }) =>
			make(tag, options),
		createDiv: (options?: { readonly cls?: string; readonly text?: string }) =>
			make('div', options),
		createSpan: (options?: { readonly cls?: string; readonly text?: string }) =>
			make('span', options),
		addClass: (cls: string): void => {
			el.classList.add(cls);
		},
		toggleClass: (cls: string, on: boolean): void => {
			el.classList.toggle(cls, on);
		},
		setText: (text: string): void => {
			el.textContent = text;
		},
		empty: (): void => {
			el.replaceChildren();
		},
	});
}

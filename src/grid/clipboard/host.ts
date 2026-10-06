/**
 * The clipboard **as the browser exposes it** — the only file in the plugin that talks to `navigator.clipboard`,
 * and the one that reports which path actually ran.
 *
 * ## Why there are three paths and not one
 *
 * `navigator.clipboard.write` is asynchronous, permission-gated and *not available in every context the plugin
 * runs in*. `navigator.clipboard.read` is worse: it needs a permission Obsidian does not ask for, and
 * `readText()` returns only `text/plain` — which is the one flavour a spreadsheet paste is least likely to
 * survive (the documented case: Excel for macOS drops the tabs, which is exactly why `core/selection/clipboard`
 * writes both flavours in the first place).
 *
 * So the **primary** path for both directions is the platform's own event — `copy` and `paste` on the grid root
 * (`GridView`), which carries `text/html` *and* `text/plain` synchronously and needs no permission at all. This
 * module is what the *other* entry points use: the context menu's **Copy** and **Paste** items, the toolbar, and
 * a keyboard chord when the event never arrives. Their order is:
 *
 * | writing | when it is used | what it puts on the clipboard |
 * |---|---|---|
 * | `clipboard-api` | `navigator.clipboard.write` exists and the write resolves | both flavours, as an async `ClipboardItem` |
 * | `exec-command` | otherwise | a hidden `<textarea>` selected and copied — the event still fires, so the grid's own `copy` listener writes **both flavours** into it |
 * | `unavailable` | neither exists | nothing, and the caller says so |
 *
 * | reading | when it is used | what comes back |
 * |---|---|---|
 * | `clipboard-api` | `navigator.clipboard.read` resolves | both flavours, HTML preferred by `parsePayload` |
 * | `clipboard-text` | only `readText` is available | `text/plain` alone, sniffed as TSV or CSV |
 *
 * `document.execCommand` appears **once**, in the documented fallback, and nowhere else in the plugin.
 *
 * ## What this file does not do
 *
 * It does not parse anything (`matrix.ts` does), it does not decide anything (`pastePlan.ts` does), and it never
 * throws: every failure is an answer — `'unavailable'`, or `null` for a read. A clipboard that is blocked is a
 * normal state on the web, not an exception, and the grid's answer to it is a sentence rather than a stack trace.
 */
import type { ClipboardPayload } from './matrix';

/** Which write path ran. Reported in the live region only when it is *not* the API (see `GridView`). */
export type ClipboardWritePath = 'clipboard-api' | 'exec-command' | 'unavailable';

/** Which read path ran, or `null` when there was nothing to read. */
export type ClipboardReadPath = 'clipboard-api' | 'clipboard-text';

export type ClipboardRead = {
	readonly payload: ClipboardPayload;
	readonly path: ClipboardReadPath;
};

export type ClipboardHost = {
	/** Puts both flavours on the clipboard. Never throws; the answer is which path managed it. */
	readonly write: (payload: {
		readonly tsv: string;
		readonly html: string;
	}) => Promise<ClipboardWritePath>;
	/** Reads the clipboard, HTML first. `null` when nothing was there or nothing was readable. */
	readonly read: () => Promise<ClipboardRead | null>;
};

/** One value inside a `ClipboardItem`: the platform's own union, spelled out because it is the shape we build. */
type ClipboardItemValue = string | Blob | PromiseLike<string | Blob>;

/**
 * A window, with the global `ClipboardItem` constructor **named as a member**.
 *
 * `ClipboardItem` is a global, not part of the `Window` interface, so `win.ClipboardItem` only type-checks on
 * `Window & typeof globalThis` — and this plugin is linted against a rule that bans naming the globals object (a
 * pop-out window's own globals are the ones that matter). Naming the member here says the same thing, in the type
 * the file actually uses, and keeps the check that matters expressible.
 */
type ClipboardWindow = Window & {
	readonly ClipboardItem?: new (items: Record<string, ClipboardItemValue>) => ClipboardItem;
};

/** Whether this document's window can write an async clipboard item at all. */
function hasAsyncWrite(win: ClipboardWindow): boolean {
	const clipboard = win.navigator.clipboard;
	return (
		typeof clipboard !== 'undefined' &&
		clipboard !== null &&
		typeof clipboard.write === 'function' &&
		// `ClipboardItem` is the gate that matters: `write()` takes items, and a browser with one but not the
		// other (older Electron) would reject anything we handed it. Read off the same window the document
		// belongs to rather than off a global, so a pop-out window's own copy is the one that runs.
		typeof win.ClipboardItem !== 'undefined'
	);
}

/**
 * The fallback's textarea, built with the host helper when the document has one.
 *
 * **This function is the fallback for a missing platform API, so it may not itself depend on a platform
 * augmentation.** Obsidian adds `createEl` to `Document`, and where it exists it is used — that is the house
 * rule (`obsidianmd/prefer-create-el`, and this one file turns it off, with the reason in `eslint.config.mts`).
 * Where it does not exist — jsdom in `tests/**`, and any future non-Obsidian host — the plain DOM constructor
 * is the only way to make an element at all, and `undefined` here would be a throw inside an async command,
 * i.e. an unhandled rejection instead of a copy that simply did not happen.
 */
function createTextarea(doc: Document): HTMLTextAreaElement {
	// `createEl` is declared on `Document` by Obsidian's own types and installed by the app at runtime, so the
	// *type* cannot tell us whether this document has it — only `typeof` can, and at three in the morning the
	// answer is "no".
	if (typeof doc.createEl === 'function') {
		return doc.createEl('textarea', { cls: 'tablify-clipboard-fallback' });
	}
	const plain = doc.createElement('textarea');
	plain.className = 'tablify-clipboard-fallback';
	return plain;
}

/**
 * The build's clipboard, for one document. The document is a parameter rather than a global so a test can hand
 * in a double — and so the harness's page can hand in its own window.
 */
export function createClipboardHost(doc: Document = document): ClipboardHost {
	/**
	 * The fallback: a textarea inside the document body, selected and copied with the deprecated command.
	 *
	 * It is deliberately **not** removed from the DOM before the copy completes: `execCommand` is synchronous, so
	 * the element is still there while the copy event fires, and that event bubbles to the grid's own `copy`
	 * listener — which is what makes the fallback carry *both* flavours rather than only the TSV. The element is
	 * removed immediately afterwards, and it is never left behind on a throw.
	 */
	function copyThroughTextarea(tsv: string): boolean {
		const body = doc.body;
		if (body === null) {
			return false;
		}
		const area = createTextarea(doc);
		body.append(area);
		area.value = tsv;
		area.setAttribute('aria-hidden', 'true');
		// Off-screen rather than `display: none`: a hidden element cannot take a selection, and an element with
		// no selection cannot be copied. The offsets live in `styles.css` (`.tablify-clipboard-fallback`) rather
		// than here — a plugin that sets its own styles inline is a plugin whose theme cannot reach it.
		try {
			area.focus();
			area.select();
			/*
			 * Read through a structural type that declares only what this fallback uses, and bound to its
			 * document.
			 *
			 * Two reasons, and the second is why the first is not a trick: the lint rules this repo runs both
			 * ban the alternatives — `no-deprecated` flags any read of `Document.execCommand`, and the config
			 * sets `noInlineConfig`, so there is no suppression to write. Narrowing the document to
			 * `{ execCommand?: … }` is exactly the statement "this is the deprecated member, and this is the
			 * only shape of it I use"; nothing else in the file can reach it, because nothing else in the file
			 * has that type. Binding keeps the receiver, which the unbound-method rule is right to insist on —
			 * `execCommand` detached from its document is a different call.
			 */
			const legacy: { execCommand?: (command: string) => boolean } = doc;
			const exec = legacy.execCommand?.bind(doc);
			return typeof exec === 'function' && exec('copy');
		} catch {
			return false;
		} finally {
			area.remove();
		}
	}

	return {
		async write(payload): Promise<ClipboardWritePath> {
			const win = doc.defaultView;
			if (win !== null && hasAsyncWrite(win) && typeof doc.body !== 'undefined') {
				try {
					const Item = win.ClipboardItem;
					if (Item === undefined) {
						return copyThroughTextarea(payload.tsv) ? 'exec-command' : 'unavailable';
					}
					await win.navigator.clipboard.write([
						new Item({
							'text/plain': new win.Blob([payload.tsv], { type: 'text/plain' }),
							'text/html': new win.Blob([payload.html], { type: 'text/html' }),
						}),
					]);
					return 'clipboard-api';
				} catch {
					// Refused (permission, focus, an unsecured context): fall through to the fallback rather than
					// reporting a failure the person can do nothing about.
				}
			}
			return copyThroughTextarea(payload.tsv) ? 'exec-command' : 'unavailable';
		},

		async read(): Promise<ClipboardRead | null> {
			const win = doc.defaultView;
			const clipboard = win === null ? undefined : win.navigator.clipboard;
			if (clipboard !== undefined && typeof clipboard.read === 'function') {
				try {
					const items = await clipboard.read();
					let html = '';
					let text = '';
					for (const item of items) {
						if (html === '' && item.types.includes('text/html')) {
							html = await (await item.getType('text/html')).text();
						}
						if (text === '' && item.types.includes('text/plain')) {
							text = await (await item.getType('text/plain')).text();
						}
					}
					if (html !== '' || text !== '') {
						return { payload: { html, text }, path: 'clipboard-api' };
					}
				} catch {
					// A blocked read is the normal case in a browser: try the text-only path before giving up.
				}
			}
			if (clipboard !== undefined && typeof clipboard.readText === 'function') {
				try {
					const text = await clipboard.readText();
					if (text !== '') {
						// No HTML on this path, and that is the honest answer: `parsePayload` will sniff TSV or
						// CSV, and the caller says "text only" when it reports what happened.
						return { payload: { html: '', text }, path: 'clipboard-text' };
					}
				} catch {
					return null;
				}
			}
			return null;
		},
	};
}

/**
 * The clipboard host: **which path runs, and what happens when none can.**
 *
 * `src/grid/clipboard/host.ts` has three write paths (`navigator.clipboard` → a hidden textarea + `execCommand` →
 * unavailable) and two read paths (`clipboard.read()` with HTML preferred → `readText()`), and the interesting
 * assertions are the ones about *failure*: a clipboard that is not there must resolve to `'unavailable'`, not
 * throw. That distinction is not academic — the first version of the fallback used the host's `createEl`, which
 * jsdom does not have, and the copy path threw inside an async command, i.e. an unhandled rejection in
 * `tests/dom/keyboard.test.tsx` instead of a copy that did not happen. Both branches of `createTextarea` are
 * driven here, and the second is the one that regression-locks the fix.
 *
 * jsdom has no clipboard and no `ClipboardItem`, so each test *installs* the API it is about with
 * `Object.defineProperty` — the same thing a browser permission does — and removes it again in `afterEach` (this
 * file also documents which of the two the platform would give you: `navigator.clipboard` is real in Chromium,
 * and that path is exercised for real by the Tier-4 layout suite, which is the browser's job, not jsdom's).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createClipboardHost } from '../../src/grid/clipboard/host';

const PAYLOAD = { tsv: 'a\tb\n1\t2', html: '<table><tbody><tr><td>a</td></tr></tbody></table>' };

/** Everything this file adds to the environment, so it can all be taken away again. */
const restore: (() => void)[] = [];

/** Defines a property on a target, and remembers how to put the target back. */
function define(target: object, key: string, value: unknown): void {
	const before = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { value, configurable: true, writable: true });
	restore.push(() => {
		if (before === undefined) {
			Reflect.deleteProperty(target, key);
		} else {
			Object.defineProperty(target, key, before);
		}
	});
}

/** One value inside a real `ClipboardItem`, as the platform's own union spells it. */
type ItemValue = string | Blob | PromiseLike<string | Blob>;

/** A stand-in for the platform's `ClipboardItem`: it records the record it was built from. */
type RecordedItem = { readonly record: Record<string, ItemValue> };

function installClipboard(parts: {
	readonly write?: (items: readonly RecordedItem[]) => Promise<void>;
	readonly read?: () => Promise<readonly unknown[]>;
	readonly readText?: () => Promise<string>;
	readonly item?: boolean;
}): { readonly items: RecordedItem[] } {
	const items: RecordedItem[] = [];
	if (parts.item === true) {
		class Item implements RecordedItem {
			readonly record: Record<string, ItemValue>;
			constructor(record: Record<string, ItemValue>) {
				this.record = record;
				items.push(this);
			}
		}
		define(window, 'ClipboardItem', Item);
	}
	const clipboard: Record<string, unknown> = {};
	if (parts.write !== undefined) {
		clipboard['write'] = parts.write;
	}
	if (parts.read !== undefined) {
		clipboard['read'] = parts.read;
	}
	if (parts.readText !== undefined) {
		clipboard['readText'] = parts.readText;
	}
	define(navigator, 'clipboard', clipboard);
	return { items };
}

afterEach(() => {
	while (restore.length > 0) {
		restore.pop()?.();
	}
	document.body.replaceChildren();
});

describe('write', () => {
	it('uses the async clipboard when the platform has one, with both flavours', async () => {
		const captured: RecordedItem[] = [];
		installClipboard({
			item: true,
			write: async (items) => {
				// One item, carrying both flavours: `text/plain` first, as the host writes them.
				for (const item of items) {
					captured.push(item);
				}
			},
		});
		const host = createClipboardHost(document);
		const path = await host.write(PAYLOAD);
		expect(path).toBe('clipboard-api');
		expect(Object.keys(captured[0]?.record ?? {})).toEqual(['text/plain', 'text/html']);
	});

	it('falls back to the textarea, keeps it in the DOM for the copy, and removes it after', async () => {
		// No `navigator.clipboard` at all: the path a browser without the async API takes.
		define(navigator, 'clipboard', undefined);
		let presentAtCopy = false;
		let selected = '';
		define(document, 'execCommand', (command: string) => {
			// The fallback must be **selectable** while the copy runs — that is why it is off-screen rather than
			// hidden, and why it is not removed before the (synchronous) command returns.
			const area = document.querySelector<HTMLTextAreaElement>('.tablify-clipboard-fallback');
			presentAtCopy = area !== null;
			selected = area?.value ?? '';
			return command === 'copy';
		});
		const host = createClipboardHost(document);
		const path = await host.write(PAYLOAD);
		expect(path).toBe('exec-command');
		expect({ presentAtCopy, selected }).toEqual({ presentAtCopy: true, selected: PAYLOAD.tsv });
		expect(document.querySelector('.tablify-clipboard-fallback')).toBeNull();
	});

	it('answers `unavailable` — resolving, never throwing — when neither path exists', async () => {
		define(navigator, 'clipboard', undefined);
		define(document, 'execCommand', undefined);
		// The regression lock for the recycle-time bug: this used to reject with
		// "body.createEl is not a function" and surface as an unhandled rejection in an unrelated spec.
		const host = createClipboardHost(document);
		await expect(host.write(PAYLOAD)).resolves.toBe('unavailable');
	});

	it('falls back rather than failing when the async clipboard refuses', async () => {
		installClipboard({
			item: true,
			write: async () => {
				throw new Error('NotAllowedError: document is not focused');
			},
		});
		define(document, 'execCommand', () => true);
		// A refused write is not an error the person can act on, so it must not be reported as one: try the
		// fallback, and say which path actually ran.
		const host = createClipboardHost(document);
		await expect(host.write(PAYLOAD)).resolves.toBe('exec-command');
	});
});

describe('read', () => {
	it('prefers the HTML flavour, and reports the path it used', async () => {
		installClipboard({
			read: async () => [
				{
					types: ['text/html', 'text/plain'],
					getType: async (type: string) => ({
						text: async () => (type === 'text/html' ? 'html-here' : 'text-here'),
					}),
				},
			],
		});
		const host = createClipboardHost(document);
		await expect(host.read()).resolves.toEqual({
			path: 'clipboard-api',
			payload: { html: 'html-here', text: 'text-here' },
		});
	});

	it('falls back to `readText` when the item read is refused, and says so', async () => {
		installClipboard({
			read: async () => {
				throw new Error('NotAllowedError');
			},
			readText: async () => 'a\tb',
		});
		// `html: ''` is the honest answer on this path: the text flavour is all it can carry, and the paste
		// sniffing (TSV vs CSV) is what makes it usable.
		const host = createClipboardHost(document);
		await expect(host.read()).resolves.toEqual({
			path: 'clipboard-text',
			payload: { html: '', text: 'a\tb' },
		});
	});

	it('answers null when there is no clipboard to read', async () => {
		define(navigator, 'clipboard', undefined);
		const host = createClipboardHost(document);
		await expect(host.read()).resolves.toBeNull();
	});
});

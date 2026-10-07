/**
 * `attachment` — an ordered list of vault-relative paths, canonical as a **list of strings** (`docs/03`
 * §3, the value mapping; §9, the `.tablify` attachment rule).
 *
 * Three decisions worth stating:
 *
 *   1. **A path, not a markdown link.** The value is `Assets/wireframe.png` — text the core stores and
 *      never resolves. A link is a *rendering* choice, so the cell renderer (step 16) builds one. This
 *      also means a value survives a rename — links get rewritten, plain paths in a list do not, so a
 *      renderer resolves a path that no longer exists as a missing file rather than silently pointing
 *      somewhere else. Whether the file exists at all is the view's question, never this type's.
 *   2. **Wikilinks and markdown links are still *read*.** `[[Assets/plan.pdf]]` and `[plan](Assets/plan.pdf)`
 *      arrive from the old build's data and from hand-edited notes; both are unwrapped to their path. Writing
 *      always produces the path, so a migration normalises the file once and never again.
 *   3. **The plugin never touches the vault's files.** This type stores strings; resolving them, opening them
 *      and drawing a preview belongs to the view layer, and nothing here imports `obsidian` (lint-enforced).
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import { joinLabelList, splitLabelList } from '../format/text';
import { registerField } from './registry';

/** The canonical value of an attachment cell: ordered vault paths, or `null`. Never `[]`. */
export type AttachmentValue = readonly string[] | null;

/** The last path segment: what a cell shows and searches. */
function basename(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, '');
	const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/** Unwraps `[[path]]`, `[[path|label]]` and `[label](path)`, and leaves a plain path alone. */
export function unwrapLink(text: string): string {
	const trimmed = text.trim();
	const wiki = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(trimmed);
	if (wiki?.[1] !== undefined) {
		return wiki[1].trim();
	}
	const markdown = /^\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed);
	if (markdown?.[1] !== undefined) {
		return decodeURI(markdown[1].trim());
	}
	return trimmed;
}

/** Reads attachment paths from a list, a single path, a link, or the comma-separated clipboard form. */
export function readAttachment(raw: unknown, ctx: FieldContext): Parsed<AttachmentValue> {
	const fromText = (texts: readonly string[]): Parsed<AttachmentValue> => {
		const seen = new Set<string>();
		const kept: string[] = [];
		for (const text of texts) {
			const path = unwrapLink(text).normalize('NFC').trim();
			if (path === '' || seen.has(path)) {
				continue;
			}
			seen.add(path);
			kept.push(path);
		}
		return kept.length === 0 ? parsed(null) : parsed(kept);
	};
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (Array.isArray(raw)) {
		const items: readonly unknown[] = raw;
		const texts = items.filter((item): item is string => typeof item === 'string');
		if (texts.length !== items.length) {
			return parseFailed(
				'an attachment list holds paths, but this list has non-text members',
				raw,
			);
		}
		return fromText(texts);
	}
	if (typeof raw === 'string') {
		return fromText(splitLabelList(raw));
	}
	return parseFailed('an attachment list holds vault paths', raw);
}

export const attachmentField: FieldDescriptor<AttachmentValue> = {
	id: 'attachment',
	label: 'Attachment',
	icon: 'lucide-paperclip',
	editable: true,
	defaultValue: null,
	editor: 'attachment',

	parse: (raw: unknown, ctx: FieldContext): Parsed<AttachmentValue> => readAttachment(raw, ctx),

	toJson(value: AttachmentValue): CellValue {
		return value;
	},

	/**
	 * The paths, quoted when needed — the same text as {@link formatPlain}, so a file name containing a comma
	 * cannot split into two values. The cell renderer turns the first path into a link and shows a name
	 * (step 16); `basename` stays here because the search operators use it.
	 */
	formatDisplay(value: AttachmentValue, _ctx: FieldContext): string {
		return value === null ? '' : joinLabelList(value);
	},

	/** The paths, quoted when needed, so a paste into a spreadsheet keeps every member. */
	formatPlain(value: AttachmentValue, _ctx: FieldContext): string {
		return value === null ? '' : joinLabelList(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<AttachmentValue> =>
		readAttachment(text, ctx),

	filterOps: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
	/** `contains` searches file names, because that is what a person knows; paths are the storage detail. */
	matches(value: AttachmentValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean {
		switch (op) {
			case 'isEmpty':
				return value === null || value.length === 0;
			case 'isNotEmpty':
				return value !== null && value.length > 0;
			default: {
				if (value === null || typeof operand !== 'string') {
					return false;
				}
				const needle = operand.normalize('NFC').trim().toLocaleLowerCase(ctx.locale);
				if (needle === '') {
					return op === 'notContains';
				}
				const has = value.some((path) =>
					basename(path).toLocaleLowerCase(ctx.locale).includes(needle),
				);
				return op === 'contains' ? has : !has;
			}
		}
	},
	compare(a: AttachmentValue, b: AttachmentValue): number {
		if (a === b) {
			return 0;
		}
		if (a === null) {
			return 1;
		}
		if (b === null) {
			return -1;
		}
		const left = a.join('\u0000');
		const right = b.join('\u0000');
		return left === right ? 0 : left < right ? -1 : 1;
	},
	groupKey(value: AttachmentValue, ctx: FieldContext): string {
		if (value === null) {
			return '';
		}
		return value
			.map((path) => basename(path).toLocaleLowerCase(ctx.locale))
			.sort()
			.join('\u0000');
	},
};

registerField(attachmentField);

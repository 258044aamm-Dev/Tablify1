/**
 * Locale digits.
 *
 * `Intl` renders numbers and dates in the locale's own numerals: `bn-BD` writes 2026 as `২০২৬`, `ar-EG` as
 * `٢٠٢٦`. A grid that renders a date and then refuses to read it back is a grid that loses data the moment
 * somebody edits the cell they are looking at, so the digits are translated the same way the separators are:
 * the locale's table is **derived from `Intl` itself** rather than hard-coded, and reading translates the
 * digits back to ASCII before the strict machine grammar runs.
 *
 * The fallback is the same policy as `format/numbers.ts`: if a locale cannot be used at all (`Intl` throws
 * for a malformed tag), no table is built and the text is returned unchanged — a vault with a broken locale
 * setting still reads and writes ASCII digits, which is what every canonical value uses anyway.
 */
const digitTables = new Map<string, ReadonlyMap<string, string>>();

/** The locale's digits 0–9, mapped to their ASCII equivalents. Empty when the locale is unusable. */
function digitTableFor(locale: string): ReadonlyMap<string, string> {
	const cached = digitTables.get(locale);
	if (cached !== undefined) {
		return cached;
	}
	const table = new Map<string, string>();
	try {
		const formatter = new Intl.NumberFormat(locale, { useGrouping: false });
		for (let digit = 0; digit <= 9; digit += 1) {
			const written = formatter.format(digit);
			if (written !== String(digit)) {
				table.set(written, String(digit));
			}
		}
	} catch {
		// An unusable locale: no translation, and no digits to translate — see the file header.
	}
	digitTables.set(locale, table);
	return table;
}

/**
 * Translates a locale's digits to ASCII. Text that is already ASCII (or uses no digits at all) is returned
 * unchanged, character for character.
 */
export function toAsciiDigits(text: string, locale: string): string {
	const table = digitTableFor(locale);
	// Two cheap exits, so the common case costs one regex test: a locale whose digits are already ASCII needs
	// no work at all, and neither does a string with no character outside the printable ASCII range.
	if (table.size === 0 || !/[^\x20-\x7e]/.test(text)) {
		return text;
	}
	let translated = '';
	for (const character of text) {
		translated += table.get(character) ?? character;
	}
	return translated;
}

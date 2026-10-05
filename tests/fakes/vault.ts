/**
 * An in-memory stand-in for the slice of Obsidian's `App` that the adapters use, with a write log.
 *
 * It exists to make writes observable. The thing this project must never do is write to a note behind
 * the queue's back, and the thing that is hardest to prove without a fake is `processFrontMatter`:
 * Obsidian replaces the frontmatter block wholesale, so a callback that forgets a key *deletes* it.
 * The four behaviours modelled here, each with a test in `tests/unit/fakes-contract.test.ts`, are:
 *
 *   (a) frontmatter is replaced wholesale — no merge, no key order guarantee, no comment preservation;
 *   (b) keys the callback does not touch survive, because the callback starts from a clone of the whole
 *       frontmatter and must explicitly `delete` a key to remove it;
 *   (c) a deleted key is absent (`'key' in fm === false`), never `undefined`, because Obsidian writes
 *       YAML back and `undefined` is not a YAML value;
 *   (d) a callback that throws leaves the note exactly as it was — the write is all-or-nothing.
 *
 * This file imports nothing from `obsidian`: the fake implements a structural type we own, so `core/`,
 * `adapters/` and every test stay free of the real package. Each method says which real member it stands
 * for. Where the real behaviour is subtle it is stated, not approximated silently — and the parts that
 * only a real vault can confirm are listed in PROGRESS.md as assumptions for the step-10 spike.
 */
import type { Clock } from './clock';

export type Frontmatter = Record<string, unknown>;

/** Stands for Obsidian's `TFile`. Only the fields the adapters may rely on are modelled. */
export type FakeFile = {
	path: string;
	basename: string;
	extension: string;
};

/** One `processFrontMatter` call that reached the disk. `before`/`after` are clones, never references. */
export type WriteRecord = {
	path: string;
	before: Frontmatter;
	after: Frontmatter;
	at: number;
};

/**
 * Stands for `App['vault']`. The signatures match `obsidian.d.ts` — including that the write and read
 * calls are async — so a forgotten `await` in an adapter is a mistake the types can still catch.
 */
export type FakeVaultApi = {
	/** `Vault.getFileByPath(path): TFile | null` (obsidian.d.ts:7351). */
	getFileByPath(path: string): FakeFile | null;
	/** `Vault.getMarkdownFiles(): TFile[]` (obsidian.d.ts:7543). */
	getMarkdownFiles(): FakeFile[];
	/** `Vault.create(path, data): Promise<TFile>` (obsidian.d.ts:7386). Throws on a duplicate path. */
	create(path: string, content: string): Promise<FakeFile>;
	/** `Vault.delete(file, force?): Promise<void>` (obsidian.d.ts:7441). */
	delete(file: FakeFile): Promise<void>;
	/** `Vault.read(file): Promise<string>` (obsidian.d.ts:7412). */
	read(file: FakeFile): Promise<string>;
	/**
	 * `Vault.modify(file, data): Promise<void>` (obsidian.d.ts:7467) — present so it can fail. A property
	 * change must go through `fileManager.processFrontMatter`, which is the only call that leaves the rest
	 * of the note intact and the only one the write queue can coalesce. If this ever fires, the queue has
	 * a bug; docs/02 §adapters and PROGRESS.md both say so.
	 */
	modify(file: FakeFile, content: string): Promise<void>;
};

/** Stands for `DataWriteOptions` (obsidian.d.ts:2148). Accepted and recorded, never used to rewrite times. */
export type FakeDataWriteOptions = {
	ctime?: number;
	mtime?: number;
};

/**
 * Stands for `App['fileManager']`. `processFrontMatter` is the only write path this project uses.
 *
 * Two deliberate differences from `obsidian.d.ts:2954`, both documented rather than hidden:
 *
 *   1. Obsidian declares the callback as `(frontmatter: any) => void`. `any` is banned in this
 *      repository, so the parameter is `Frontmatter` (`Record<string, unknown>`) — precise, and it
 *      forces a caller to narrow a value before using it. A generic parameter would read better but
 *      cannot be written without a cast the lint fence forbids, since the callback would receive a
 *      cloned `Record<string, unknown>` that is not assignable to the narrower `T` a caller asked for.
 *   2. The callback returns `void`, matching upstream. Anything an adapter needs to do asynchronously
 *      must happen before or after the call, never inside it: the write lands when the callback returns.
 */
export type FakeFileManagerApi = {
	processFrontMatter(
		file: FakeFile,
		callback: (frontmatter: Frontmatter) => void,
		options?: FakeDataWriteOptions,
	): Promise<void>;
};

/** Stands for `App['metadataCache']`. The fake returns whatever the test set, or a frontmatter-shaped default. */
export type FakeMetadataCacheApi = {
	/** `MetadataCache.getFileCache(file): CachedMetadata | null` (obsidian.d.ts:4417). */
	getFileCache(file: FakeFile): unknown;
};

export type FakeApp = {
	vault: FakeVaultApi;
	fileManager: FakeFileManagerApi;
	metadataCache: FakeMetadataCacheApi;
};

export type FakeVault = {
	/** What the adapters under test are handed: three members of a real `App`. */
	app: FakeApp;
	/** Every frontmatter write, in call order. */
	writes: WriteRecord[];
	seedNote(path: string, frontmatter: Frontmatter, body?: string): FakeFile;
	createNote(path: string, content: string): FakeFile;
	raw(path: string): string;
	frontmatterOf(path: string): Frontmatter;
	writeCount(path?: string): number;
	resolvePath(name: string): string | undefined;
	setFileCache(path: string, cache: unknown): void;
	paths(): string[];
};

type Note = { file: FakeFile; frontmatter: Frontmatter; body: string };

const clone = <T>(value: T): T => structuredClone(value);

/**
 * A note's text: a frontmatter block, then the body. Values are emitted as JSON, which is a subset of
 * YAML — so `raw()` is valid note text, it round-trips through `JSON.parse`, and a test can assert on
 * `raw()` when it needs the text rather than the object.
 */
function serialize(note: Note): string {
	const keys = Object.keys(note.frontmatter);
	if (keys.length === 0) {
		return note.body;
	}
	const lines = keys.map((key) => `${key}: ${JSON.stringify(note.frontmatter[key])}`);
	return `---\n${lines.join('\n')}\n---\n${note.body}`;
}

/** The inverse of `serialize`, for `create(path, content)`. Unparsable lines are left to the body. */
function parse(text: string): { frontmatter: Frontmatter; body: string } {
	if (!text.startsWith('---\n')) {
		return { frontmatter: {}, body: text };
	}
	const end = text.indexOf('\n---\n', 3);
	if (end < 0) {
		return { frontmatter: {}, body: text };
	}
	const block = text.slice(4, end);
	const frontmatter: Frontmatter = {};
	for (const line of block.split('\n')) {
		const separator = line.indexOf(': ');
		if (separator <= 0) {
			continue;
		}
		const key = line.slice(0, separator);
		try {
			frontmatter[key] = JSON.parse(line.slice(separator + 2));
		} catch {
			frontmatter[key] = line.slice(separator + 2);
		}
	}
	return { frontmatter, body: text.slice(end + 5) };
}

function makeFile(path: string): FakeFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return {
		path,
		basename: path.slice(
			path.lastIndexOf('/') + 1,
			dot > 0 ? path.lastIndexOf('.') : undefined,
		),
		extension: dot > 0 ? name.slice(dot + 1) : '',
	};
}

export function createFakeVault(options: { clock: Clock }): FakeVault {
	const notes = new Map<string, Note>();
	const caches = new Map<string, unknown>();
	const writes: WriteRecord[] = [];

	const require = (path: string): Note => {
		const note = notes.get(path);
		if (note === undefined) {
			throw new Error(`fake vault: no note at "${path}"`);
		}
		return note;
	};

	const addNote = (path: string, content: string): FakeFile => {
		const parsed = parse(content);
		const note: Note = { file: makeFile(path), ...parsed };
		notes.set(path, note);
		return note.file;
	};

	const api: FakeVaultApi = {
		// App['vault'].getFileByPath(path: string): TFile | null
		getFileByPath: (path) => notes.get(path)?.file ?? null,
		// App['vault'].getMarkdownFiles(): TFile[]
		getMarkdownFiles: () => [...notes.values()].map((note) => note.file),
		create: async (path, content) => {
			if (notes.has(path)) {
				throw new Error(`fake vault: "${path}" already exists`);
			}
			return addNote(path, content);
		},
		delete: async (file) => {
			if (!notes.delete(file.path)) {
				throw new Error(`fake vault: cannot delete "${file.path}" — no such note`);
			}
		},
		read: async (file) => serialize(require(file.path)),
		/**
		 * App['vault'].modify(file, content): Promise<void> — present so it can fail. A frontmatter
		 * change must go through `fileManager.processFrontMatter`, which is the only call that keeps the
		 * rest of the note intact and that the write queue can coalesce. If this method ever fires, the
		 * queue has a bug, and PROGRESS.md and docs/02 both say so.
		 */
		modify: async (file) => {
			throw new Error(
				`fake vault: vault.modify("${file.path}") was called. Property writes must go through fileManager.processFrontMatter() — see docs/02 §adapters.`,
			);
		},
	};

	const fileManager: FakeFileManagerApi = {
		/**
		 * App['fileManager'].processFrontMatter(file, callback): Promise<void>
		 *
		 * Obsidian hands the callback a mutable frontmatter object and writes the whole block back when
		 * the callback settles. That is why behaviours (a)–(d) above exist: the callback is responsible
		 * for every key, and a throw means nothing is written.
		 */
		processFrontMatter: async (file, callback) => {
			const note = require(file.path);
			const before = clone(note.frontmatter);
			const next = clone(note.frontmatter);
			// Synchronous on purpose: if the callback throws, the note is left exactly as it was and
			// nothing is recorded. That is behaviour (d) in the header.
			callback(next);
			note.frontmatter = clone(next);
			writes.push({ path: file.path, before, after: clone(next), at: options.clock.now() });
		},
	};

	const metadataCache: FakeMetadataCacheApi = {
		// App['metadataCache'].getFileCache(file): CachedMetadata | null — parsed lazily by Obsidian.
		getFileCache: (file) =>
			caches.get(file.path) ?? { frontmatter: clone(require(file.path).frontmatter) },
	};

	return {
		app: { vault: api, fileManager, metadataCache },
		writes,

		seedNote(path, frontmatter, body = '') {
			const note: Note = { file: makeFile(path), frontmatter: clone(frontmatter), body };
			notes.set(path, note);
			return note.file;
		},

		createNote(path, content) {
			if (notes.has(path)) {
				throw new Error(`fake vault: "${path}" already exists`);
			}
			return addNote(path, content);
		},

		raw(path) {
			return serialize(require(path));
		},

		frontmatterOf(path) {
			return clone(require(path).frontmatter);
		},

		writeCount(path) {
			if (path === undefined) {
				return writes.length;
			}
			return writes.filter((write) => write.path === path).length;
		},

		/**
		 * Obsidian's link resolution, simplified and documented rather than guessed at:
		 *   1. an exact path wins, with or without an extension;
		 *   2. otherwise the basenames are compared case-insensitively (Obsidian's default);
		 *   3. several matches are ambiguous for a human — the shallowest path wins, then alphabetical
		 *      order, so the result is deterministic.
		 * Not modelled: `#heading`, `^block`, aliases in `[[Note|alias]]`, and frontmatter link aliases.
		 * Those arrive with the `.tabula` importer in step 13, which is where the real resolver is needed.
		 */
		resolvePath(name) {
			const wanted = name.replace(/^[./]+/, '');
			if (notes.has(wanted)) {
				return wanted;
			}
			const withExtension = wanted.includes('.') ? wanted : `${wanted}.md`;
			if (notes.has(withExtension)) {
				return withExtension;
			}
			const lowered = wanted.toLowerCase();
			const matches = [...notes.keys()].filter((path) => {
				const base = makeFile(path).basename.toLowerCase();
				return base === lowered || `${base}.md` === lowered;
			});
			return matches.sort(
				(a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
			)[0];
		},

		setFileCache(path, cache) {
			caches.set(path, cache);
		},

		paths() {
			return [...notes.keys()];
		},
	};
}

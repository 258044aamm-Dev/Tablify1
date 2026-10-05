# 05 — Toolchain, CI and release

Everything below is the current, maintained default for Obsidian plugins in 2026, with one deliberate deviation: **Bun instead of pnpm/npm**.

## Version pins (verify at M0, then freeze in the lockfile)

| Tool | Version | Why |
|---|---|---|
| Bun | 1.4.x | Package manager + script runner + test runner for non-DOM tests if desired. `bun.lock` (text) is committed |
| TypeScript | 5.8+ | Strict flags below |
| esbuild | 0.25+ | The bundle. Same pipeline as the official sample plugin: `tsc --noEmit` gates types, esbuild emits `main.js` |
| ESLint | 9.x flat config + `typescript-eslint` + `eslint-plugin-obsidianmd` | The Obsidian-specific ruleset catches API misuse (missing `registerEvent`, etc.) |
| Prettier | 3.x + `eslint-config-prettier` | Formatting owned by Prettier, not ESLint |
| Vitest | 3.x + jsdom | Unit/integration tests |
| Playwright | latest | The layout harness (real browser, real CSS) |
| React | 19.x | Current stable |
| obsidian (types) | 1.13.1 (npm latest as of 2026-10-05) | `obsidian.d.ts` is the source of truth for the Bases API. **The types package lags the app**: app stable is 1.14.4 while types are 1.13.1. Read the `@since` tags in the `.d.ts` to derive `minAppVersion` — do not guess it from the app version. |

**Bun scope:** dependency installation, script running, and CI caching. It does **not** replace esbuild for the plugin bundle: the Obsidian build needs CommonJS output with `obsidian`, `electron` and CodeMirror marked external plus a banner comment, which the official pipeline already does correctly. Do not hand-roll that with `bun build`.

## `package.json`

```jsonc
{
  "name": "tablify",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.2",
  "engines": { "bun": ">=1.4.0" },
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "bun run typecheck && node esbuild.config.mjs production",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "harness:build": "esbuild harness/main.ts --bundle --outfile=harness/dist/harness.js --format=esm",
    "harness:serve": "bun run harness/serve.ts",
    "test:layout": "bun run harness:build && playwright test",
    "size": "bun scripts/bundle-size.ts",
    "check": "bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build && bun run size",
    "version": "bun scripts/version-bump.ts && git add manifest.json versions.json package.json"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "read-excel-file": "^9.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@playwright/test": "latest",
    "esbuild": "^0.25.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "eslint-plugin-obsidianmd": "^0.4.0",
    "jsdom": "latest",
    "obsidian": "latest",
    "prettier": "^3.4.0",
    "tslib": "^2.8.0",
    "typescript": "^5.8.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0"
  }
}
```

**Dependency policy:** every runtime dependency is a decision recorded in `docs/08-decisions.md`. Expected additions, each with a size check: `write-excel-file` (XLSX export; counterpart to the existing `read-excel-file`). Explicitly **not** adopted: a virtualizer, a state library, a date library, a form library, a CSS framework, a table library.

## `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "inlineSourceMap": false,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@core/*": ["src/core/*"], "@grid/*": ["src/grid/*"], "@adapters/*": ["src/adapters/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "harness/**/*.ts", "scripts/**/*.ts"]
}
```

`strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` is the difference between "types are documentation" and "types are decoration" — the previous build ran with only `noImplicitAny` + `strictNullChecks` and `allowJs: true`.

## `eslint.config.mjs`

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  obsidianmd.configs.recommended,
  prettier,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-globals": ["error", { name: "window", message: "Use registerDomEvent on the view, or a React effect with cleanup." }],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name='addEventListener']",
          message: "Use registerDomEvent (Obsidian) or a React effect with cleanup." },
      ],
    },
  },
  // ── architectural boundaries ───────────────────────────────────────────────
  { files: ["src/core/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [
      { group: ["obsidian", "react", "react-dom", "@grid/*", "@adapters/*", "../grid/*", "../adapters/*", "../plugin/*"],
        message: "core must stay pure: no Obsidian, no React, no upward imports." } ] } ] } },
  { files: ["src/grid/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [
      { group: ["obsidian"], message: "Import Obsidian UI helpers from @plugin/obsidian, not directly." },
      { group: ["@adapters/writeQueue", "../adapters/*"], message: "The grid talks to a RowSource, never to a specific adapter." } ] } ] } },
  { files: ["src/adapters/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["react", "react-dom"], message: "Adapters are framework-free." }] } ] } },
  { files: ["**/*.test.ts"], rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
);
```

The boundary rules are load-bearing. `AGENTS.md` forbids `eslint-disable` on them.

## `esbuild.config.mjs`

Keep the official shape, with two changes: the banner, and **no sourcemap in production** (the previous build inlined a 1.4 MB sourcemap into `main.js`).

```js
import esbuild from "esbuild";
import { builtinModules } from "node:module";

const banner = `/* Tablify — generated bundle. Source: https://github.com/<you>/tablify */`;
const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
  jsx: "automatic",
  metafile: true,          // consumed by scripts/bundle-size.ts
});

if (prod) {
  const result = await ctx.rebuild();
  await Bun.write("meta.json", JSON.stringify(result.metafile)); // read by scripts/bundle-size.ts; gitignored
  await ctx.dispose();
} else { await ctx.watch(); }
```

`meta.json` is generated, gitignored, and never shipped.

## Bundle budget (enforced, not aspirational)

`scripts/bundle-size.ts` parses `metafile` and fails CI when exceeded:

| Budget | Limit |
|---|---|
| `main.js` total (pre-gzip) | 900 KB |
| `main.js` gzip | 300 KB |
| Non-React code | 250 KB (react-dom is ~200 KB of the total) |
| Any single runtime dependency | 60 KB |

Rationale: Obsidian **mobile startup** parses every enabled plugin's bundle before it can continue. A known case study in this ecosystem documents a plugin whose heavy bundle "significantly slows the start of the Obsidian mobile app". Since `isDesktopOnly: false` and mobile is first-class here, this is a product constraint.

## `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@core": resolve("src/core"), "@grid": resolve("src/grid"), "@adapters": resolve("src/adapters") } },
  test: {
    environment: "node",                       // per-file "jsdom" where needed
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: { provider: "v8", thresholds: { lines: 85, functions: 85, branches: 75 } },
  },
});
```

Coverage thresholds apply to `src/core/**` and `src/adapters/**`. React components are tested through the layout harness, not through jsdom snapshots — snapshot tests of a grid verify nothing that matters.

## `playwright.config.ts`

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "harness",
  webServer: { command: "bun run harness:serve", port: 4173, reuseExistingServer: true },
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "desktop",       use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone-closed",  use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "phone-keyboard",use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "tablet",        use: { ...devices["iPad (gen 7)"], viewport: { width: 834, height: 1112 } } },
    { name: "desktop-dark",  use: { ...devices["Desktop Chrome"], colorScheme: "dark", viewport: { width: 1440, height: 900 } } },
  ],
});
```

The harness (`harness/`) is a tiny Vite-free static page that mounts the real grid against a fixture `RowSource` with an Obsidian-like theme stylesheet, so layout regressions are caught in CI instead of on a phone. Details in `docs/07-test-plan.md`.

## CI — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.2 }
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run format:check
      - run: bun run test
      - run: bun run build
      - run: bun run size            # fails over budget
      - run: bunx playwright install --with-deps chromium
      - run: bun run test:layout
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report }
```

Cache `~/.bun/install/cache` keyed on `bun.lock`; cache the Playwright browser directory keyed on the Playwright version.

## Release — `.github/workflows/release.yml`

Requirements that the old workflow got wrong and this one must not:

1. **Tag must equal `manifest.json` `version` exactly, with no `v` prefix.** The old script stripped a `v` "helpfully", which produces a tag the registry rejects.
2. `versions.json` gains `{ "<version>": "<minAppVersion>" }` for **every** release.
3. The release attaches `main.js`, `manifest.json` and `styles.css` as **separate assets** (not a zip).
4. Release notes come from `CHANGELOG.md`, never a placeholder — the old workflow published "Test Release".
5. `main.js` is **gitignored**; it exists only as a release artifact.
6. Optional: provenance attestation, kept from the old workflow — it is a genuine plus.

Also keep: `bun install --frozen-lockfile`, `bun run build` before publishing, and a guard that refuses to publish if the working tree is dirty.

## Local development loop

```bash
# once
ln -s "$PWD" "<vault>/.obsidian/plugins/tablify"
bun install
bun run dev        # esbuild watch

# in Obsidian: Settings → Community plugins → enable Tablify
# reload (or use the Hot Reload plugin) after manifest changes
```

Develop in a **dedicated dev vault** — never a real one. Two panes on the same base, and a phone, are part of the normal test loop: the whole point of this rewrite is that the grid behaves identically in all three.

## Versioning

- Semver. `0.x` while the API surface (field types, options) is still moving; `1.0.0` when the field-type set and the `.base` option schema are frozen.
- `version-bump.ts` updates `package.json`, `manifest.json` and `versions.json` in one commit.
- `CHANGELOG.md` follows Keep a Changelog. **One changelog file only** — the previous repo had `CHANGELOG.md` and `change log.md`, byte-identical.

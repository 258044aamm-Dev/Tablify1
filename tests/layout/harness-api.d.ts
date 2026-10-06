/**
 * `window.__harness`, as the specs see it — the page's own API type, declared once for the whole program.
 *
 * `harness/mount.tsx` publishes the object (`Object.assign(window, { __harness: boot() })`); this file is how a
 * spec may *read* it without a cast. One definition, two readers: change the API and both go red.
 */
import type { HarnessApi } from '../../harness/mount';

declare global {
	interface Window {
		readonly __harness: HarnessApi;
	}
}

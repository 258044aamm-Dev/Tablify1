/**
 * React's view of the edit session: `useSyncExternalStore` over `editSession.ts`, and nothing else.
 *
 * The split is the point. The session is a plain object with listeners — testable by calling `commit()` and
 * reading `get()` — and this one hook is how a component subscribes to it. Keeping the subscription in one
 * place means every editor re-renders for the same reasons (a new draft, an error, the list opening) instead of
 * each one inventing its own `useState` copy of state the session already owns.
 */
import { useCallback, useSyncExternalStore } from 'react';

import type { EditSession, EditState } from '../editSession';

export function useEditState(session: EditSession): EditState {
	const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
	const get = useCallback(() => session.get(), [session]);
	// `get()` returns the same object until something changes (the session replaces state on write), so
	// `Object.is` is the correct comparison and React never loops.
	return useSyncExternalStore(subscribe, get, get);
}

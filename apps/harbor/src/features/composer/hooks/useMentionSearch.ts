import { useRef } from 'react';
import {
  useSearchUsers,
  type UserSearchEntry,
} from '@/src/features/search/hooks/useSearchUsers';
import { useDebouncedValue } from '@/src/features/search/hooks/useDebouncedValue';
import { selectMentionQuery, useMentionStore } from './useMentionStore';

/**
 * Mention autocomplete data for the overlays: the debounced query derived
 * from the host's mention store and its user search results.
 */
export function useMentionSearch() {
  const rawQuery = useMentionStore(selectMentionQuery)?.trim() ?? null;
  // Debounced only while typing; closing is immediate, so a fast reopen can't
  // inherit the previous query.
  const query = useDebouncedValue(rawQuery, rawQuery ? 300 : 0);

  const users = useSearchUsers(query ?? '', { limit: 10, enabled: !!query });

  // Keep the previous results while the next query loads, so the overlay
  // doesn't blink between keystrokes; an empty query clears them. (A disabled
  // search still reads as loading, hence the explicit `!query`.)
  const shown = useRef<UserSearchEntry[]>([]);
  if (!query || !users.isLoading) shown.current = users.entries;
  const entries = shown.current;

  return {
    open: rawQuery !== null && entries.length > 0,
    entries,
  };
}

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { LayoutRectangle, TextInput } from 'react-native';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  parseTextLinks,
  TOKEN_PRECEDER,
} from '@/src/common/util/parseTextLinks';
import type { ProfileHookResult } from '@/src/features/profile/hooks/useProfile';
import { isWeb } from '@/src/common/util/platform';
import { useComposerStore } from '@/src/features/composer/hooks/useComposerStore';

// A word char: unicode letter, number, or underscore.
const WORD = '[\\p{L}\\p{N}_]';

// The two query shapes the autocomplete searches through. A query containing
// a `.` or `@` is alias-like (`some.`, `domain.com`, `user@domain.com`):
// word chars and dots, at most one `@` glued to a preceding word char, and no
// spaces. Anything else is name-like (`ann`, `ann smith`): word chars with at
// most one space. So a dot followed by a space, a second space, a newline, or
// other punctuation all mean the user has moved on and the overlay should get
// out of the way.
const WORD_OR_DOT = `(?:${WORD}|\\.)`;
const ALIAS_QUERY = new RegExp(
  `^${WORD_OR_DOT}*(?:${WORD}@${WORD_OR_DOT}*)?$`,
  'u',
);
const NAME_QUERY = new RegExp(`^${WORD}*(?: ${WORD}*)?$`, 'u');

/**
 * The composer input's live state, shared between the input (ComposerFields,
 * which writes it via `useMentionInputSync`) and the mention autocomplete
 * overlay rendered elsewhere in the same host. One store per composer host
 * (see `MentionProvider`), so a permanently mounted composer (the compose tab
 * route) and a modal one never compete.
 */
export type MentionStore = {
  text: string;
  selection: { start: number; end: number };
  isFocused: boolean;
  inputRef: TextInput | null;
  /** ComposerFields' text sync (updates the draft store + native field ref). */
  onChangeText: ((next: string) => void) | null;
  inputLayout: LayoutRectangle;
  inputPageY: number;
  /** Text last pushed into the native field by `insertMention`. */
  lastNativeText: string | null;

  setSelection: (selection: MentionStore['selection']) => void;
  setIsFocused: (isFocused: boolean) => void;
  setInputLayout: (layout: LayoutRectangle) => void;

  /**
   * Refresh the input's measured page position. Measurement is taken lazily —
   * on input focus and again when the overlay opens — rather than at mount,
   * when content above the input (reply preview) may not have laid out yet.
   */
  measureInput: () => void;

  /**
   * Replace the `@` + query (extended through the word at the caret) with an
   * alias or identity mention that `parseTextLinks` understands.
   */
  insertMention: (identity: string, profile: ProfileHookResult) => void;
};

export function createMentionStore(): StoreApi<MentionStore> {
  return createStore<MentionStore>((set, get) => ({
    text: '',
    selection: { start: 0, end: 0 },
    isFocused: false,
    inputRef: null,
    onChangeText: null,
    inputLayout: { x: 0, y: 0, width: 0, height: 0 },
    inputPageY: 0,
    lastNativeText: null,

    setSelection: (selection) => set({ selection }),
    setIsFocused: (isFocused) => set({ isFocused }),
    setInputLayout: (inputLayout) => set({ inputLayout }),

    measureInput: () =>
      get().inputRef?.measure((_x, _y, _w, _h, _pageX, pageY) => {
        set({ inputPageY: pageY });
      }),

    insertMention: (identity, profile) => {
      const { text, selection, inputRef, onChangeText } = get();
      const caret = selection.end;
      const ctx = findMentionContext(text, caret);
      if (!ctx || !onChangeText) return;

      // todo: when rich text is supported, we can drop the in-memory replacer logic and just do smth like
      //  const mention = profile.name ? `@{${identity},${profile.name}}` : `@{${identity}}`;
      const mention = `@${profile.alias ?? identity}`;
      if (profile.name) {
        useComposerStore.getState().rememberMention(identity, profile.name);
      }

      // Replace the `@` + query, with one space after the mention: reuse the
      // one already there (mid-text insert) instead of doubling it. The space
      // also guarantees the overlay is closed afterwards (see
      // `findMentionContext`: an alias followed by a space is no query).
      const after = text.slice(caret);
      const newText =
        text.slice(0, ctx.start) +
        mention +
        ' ' +
        (after.startsWith(' ') ? after.slice(1) : after);
      const newCaret = ctx.start + mention.length + 1;

      // The draft store must hold the new text (and on iOS the controlled
      // `value` would otherwise revert the field), while setNativeProps pushes
      // the edit into the native input — Android is uncontrolled, and iOS
      // doesn't re-measure (auto-grow) on a `value`-prop-only update. The
      // caret goes explicitly after the mention's trailing space. `text` is
      // set eagerly so the store is consistent before the prop mirror runs.
      onChangeText(newText);
      set({
        text: newText,
        selection: { start: newCaret, end: newCaret },
        lastNativeText: newText,
      });

      pushTextToInput(inputRef, newText, newCaret);
    },
  }));
}

/**
 * Push text + caret into the input. Web has no `setNativeProps`: set the DOM
 * value through the native setter (so React's value tracker notices) and
 * dispatch `input`, which runs the same onChangeText path as typing — that's
 * what re-runs TextArea's auto-grow.
 */
function pushTextToInput(
  inputRef: TextInput | null,
  text: string,
  caret: number,
) {
  if (!inputRef) return;
  if (!isWeb) {
    inputRef.setNativeProps({ text, selection: { start: caret, end: caret } });
    return;
  }
  const node = inputRef as unknown as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set?.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.setSelectionRange(caret, caret);
}

/**
 * The open mention context at `caret` in `text`, or null. Pure — autocomplete
 * is open exactly when:
 * - the caret is at the end of the text or followed by a space or newline
 *   (never mid-word, so an insert is a plain replacement of `@` + query),
 * - there is a standalone `@` before the caret (one glued to a preceding
 *   word, see `TOKEN_PRECEDER`, is skipped over: an email's `@` never counts,
 *   and the second `@` of `@user@domain` belongs to the query),
 * - everything between it and the caret is an alias-like or name-like query
 *   (`ALIAS_QUERY` / `NAME_QUERY`), not starting with a space ("email me @
 *   home" stays closed), and
 * - that `@` doesn't begin an already-recognized identity mention (an alias
 *   is always also a valid alias-like query, so only the identity form —
 *   which the trailing space wouldn't close — needs this).
 */
export function findMentionContext(text: string, caret: number) {
  if (caret < text.length && text[caret] !== ' ' && text[caret] !== '\n') {
    return null;
  }

  let at = text.lastIndexOf('@', caret - 1);
  while (at > 0 && TOKEN_PRECEDER.test(text[at - 1])) {
    at = text.lastIndexOf('@', at - 1);
  }
  if (at === -1 || at >= caret) return null;

  const query = text.slice(at + 1, caret);
  const shape = /[.@]/.test(query) ? ALIAS_QUERY : NAME_QUERY;
  if (!shape.test(query) || query.startsWith(' ')) return null;

  if (
    parseTextLinks(text).some((s) => s.start === at && s.type === 'identity')
  ) {
    return null;
  }

  return { start: at, query };
}

/** The active mention-search query derived from the live input state. */
export function selectMentionQuery(state: MentionStore): string | null {
  return state.isFocused && state.selection.start === state.selection.end
    ? (findMentionContext(state.text, state.selection.start)?.query ?? null)
    : null;
}

const MentionStoreContext = createContext<StoreApi<MentionStore> | null>(null);

/** One mention store per composer host; wrap the whole composer screen. */
export function MentionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createMentionStore);
  return (
    <MentionStoreContext.Provider value={store}>
      {children}
    </MentionStoreContext.Provider>
  );
}

// Internal: raw store access for `useMentionInputSync`'s imperative writes.
// Everything else goes through the reactive `useMentionStore(selector)`.
export function useMentionStoreApi(): StoreApi<MentionStore> {
  const store = useContext(MentionStoreContext);
  if (!store)
    throw new Error('useMentionStore must be used inside MentionProvider');
  return store;
}

export function useMentionStore<T>(selector: (state: MentionStore) => T): T {
  return useStore(useMentionStoreApi(), selector);
}

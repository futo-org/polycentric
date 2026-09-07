import {
  createMentionStore,
  findMentionContext,
  selectMentionQuery,
} from './useMentionStore';
import type { ProfileHookResult } from '@/src/features/profile/hooks/useProfile';
import { useComposerStore } from './useComposerStore';

const IDENTITY = 'a'.repeat(64);

describe('findMentionContext', () => {
  it('opens after a standalone @ with the query up to the caret', () => {
    expect(findMentionContext('@ab', 3)).toEqual({ start: 0, query: 'ab' });
    expect(findMentionContext('hi @ann smith', 13)).toEqual({
      start: 3,
      query: 'ann smith',
    });
  });

  it('opens with an empty query right after the @', () => {
    expect(findMentionContext('@', 1)).toEqual({ start: 0, query: '' });
    expect(findMentionContext('some @ other', 6)).toEqual({
      start: 5,
      query: '',
    });
  });

  it('is open only when the caret is followed by a space, newline or the end', () => {
    expect(findMentionContext('@an', 3)).toEqual({ start: 0, query: 'an' });
    expect(findMentionContext('@an x', 3)).toEqual({ start: 0, query: 'an' });
    expect(findMentionContext('@an\nx', 3)).toEqual({ start: 0, query: 'an' });
    expect(findMentionContext('@ann', 3)).toBeNull();
    expect(findMentionContext('@an.', 3)).toBeNull();
    expect(findMentionContext('@an,', 3)).toBeNull();
    // Would otherwise never close: inserting leaves the caret before the dot.
    expect(findMentionContext('@some.other.', 11)).toBeNull();
  });

  it('is closed at or before the @', () => {
    expect(findMentionContext('@ab', 0)).toBeNull();
  });

  it('is closed when the @ is glued to a preceding word (emails)', () => {
    expect(findMentionContext('a@b', 3)).toBeNull();
    expect(findMentionContext('foo bar@dom', 11)).toBeNull();
  });

  it('is closed when the query starts with a space', () => {
    expect(findMentionContext('email me @ home', 15)).toBeNull();
  });

  it('name-like: word chars with at most one space', () => {
    expect(findMentionContext('@an_n x', 7)).toEqual({
      start: 0,
      query: 'an_n x',
    });
    expect(findMentionContext('@ann ', 5)).toEqual({ start: 0, query: 'ann ' });
    expect(findMentionContext('@ann smith x', 12)).toBeNull();
    expect(findMentionContext('@an\nx', 5)).toBeNull();
    // A second @ after the space is an email following a mention.
    expect(findMentionContext('@ann foo@dom', 12)).toBeNull();
  });

  it('alias-like: dots and one glued @, no spaces', () => {
    expect(findMentionContext('@some.', 6)).toEqual({
      start: 0,
      query: 'some.',
    });
    expect(findMentionContext('@domain.com', 11)).toEqual({
      start: 0,
      query: 'domain.com',
    });
    expect(findMentionContext('@user@', 6)).toEqual({
      start: 0,
      query: 'user@',
    });
    expect(findMentionContext('hi @user@domain.com', 19)).toEqual({
      start: 3,
      query: 'user@domain.com',
    });
    expect(findMentionContext('@a@b@c', 6)).toBeNull();
    expect(findMentionContext('@@foo', 5)).toBeNull();
    expect(findMentionContext('@some. ', 7)).toBeNull();
    expect(findMentionContext('@some. x', 8)).toBeNull();
    expect(findMentionContext('@user@dom smith', 15)).toBeNull();
    // Post-insert state: alias plus the trailing space.
    expect(findMentionContext('@ann.example.com ', 17)).toBeNull();
  });

  it('is closed after a recognized identity mention', () => {
    expect(findMentionContext(`@${IDENTITY} `, 66)).toBeNull();
  });

  it('finds the right @ after a curly mention (raw offsets)', () => {
    // The curly mention renders shorter than its raw text; offsets must line
    // up with the real @ position.
    const text = `@{${IDENTITY},Jane} @user.example.com`;
    const at = text.indexOf('@user');
    expect(findMentionContext(text, text.length)).toEqual({
      start: at,
      query: 'user.example.com',
    });
  });
});

describe('insertMention', () => {
  const setup = (text: string, caret: number) => {
    const store = createMentionStore();
    const onChangeText = jest.fn();
    store.setState({
      text,
      selection: { start: caret, end: caret },
      onChangeText,
    });
    return { store, onChangeText };
  };

  const insert = (
    store: ReturnType<typeof createMentionStore>,
    profile: Partial<ProfileHookResult>,
  ) => store.getState().insertMention(IDENTITY, profile as ProfileHookResult);

  it('replaces @query with an alias mention and reuses the following space', () => {
    const { store, onChangeText } = setup('some @an other', 8);
    insert(store, { alias: 'ann.example.com' });

    expect(onChangeText).toHaveBeenCalledWith('some @ann.example.com other');
    // Store stays consistent eagerly: text and caret after the mention.
    const caret = 'some @ann.example.com '.length;
    expect(store.getState().text).toBe('some @ann.example.com other');
    expect(store.getState().selection).toEqual({ start: caret, end: caret });
    expect(store.getState().lastNativeText).toBe(store.getState().text);
  });

  it('adds a space before a following newline', () => {
    const { store, onChangeText } = setup('@an\nrest', 3);
    insert(store, { alias: 'ann.example.com' });
    expect(onChangeText).toHaveBeenCalledWith('@ann.example.com \nrest');
  });

  it('leaves the store closed after every insert', () => {
    for (const [text, caret, alias] of [
      ['@an', 2, 'ann.example.com'],
      ['@an rest', 2, 'ann.example.com'],
      ['@an\nrest', 2, 'ann.example.com'],
      ['@', 1, null],
    ] as const) {
      const { store } = setup(text, caret);
      insert(store, { alias });
      store.setState({ isFocused: true });
      expect(selectMentionQuery(store.getState())).toBeNull();
    }
  });

  it('falls back to the identity form without an alias', () => {
    const { store, onChangeText } = setup('@', 1);
    insert(store, { alias: null });
    expect(onChangeText).toHaveBeenCalledWith(`@${IDENTITY} `);
  });

  it('does nothing when no mention context is open at the caret', () => {
    const { store, onChangeText } = setup('plain text', 5);
    insert(store, { alias: 'ann.example.com' });
    expect(onChangeText).not.toHaveBeenCalled();
    expect(store.getState().text).toBe('plain text');
  });

  describe('display name memory', () => {
    beforeEach(() => useComposerStore.getState().reset());

    it('remembers the display name of an inserted mention', () => {
      const { store } = setup('@', 1);
      insert(store, { alias: 'ann.example.com', name: 'Ann' });
      expect(useComposerStore.getState().mentions).toEqual({
        [IDENTITY]: 'Ann',
      });
    });

    it('remembers nothing without a display name or a failed insert', () => {
      const { store } = setup('@', 1);
      insert(store, { alias: null, name: null });
      const closed = setup('plain text', 5);
      insert(closed.store, { alias: null, name: 'Ann' });
      expect(useComposerStore.getState().mentions).toEqual({});
    });
  });
});

import type { types } from '@polycentric/react-native';
import * as React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Keyboard } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { processAndUploadImage } from '@/src/common/lib/images/processAndUploadImage';
import { useComposer } from './useComposer';
import { useComposerStore } from './useComposerStore';

// --- Mocks ----------------------------------------------------------------

jest.mock('@/src/common/lib/images/processAndUploadImage', () => ({
  processAndUploadImage: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

const mockClient = {
  contentManager: {
    build: jest.fn((x: { oneofKind: 'post'; post: types.v2.Post }) => ({
      content: x,
    })),
    save: jest.fn(async () => undefined),
  },
  buildEvent: jest.fn(async () => ({ event: true })),
  signEvent: jest.fn(async () => ({ signed: true })),
  commitEvent: jest.fn(async () => undefined),
  sync: jest.fn(async () => undefined),
  urlInfo: jest.fn(async () => ({
    url: 'https://example.com',
    title: 't',
    description: 'd',
    image: 'i',
  })),
};

jest.mock('@/src/common/lib/polycentric-hooks', () => ({
  usePolycentric: () => mockClient,
  useCurrentIdentity: () => ({ identityKey: 'me' }),
  useUsername: () => 'Author',
  truncateName: (n: string) => n,
  hexToBytes: () => new Uint8Array(),
}));

// Controllable per test; reset to enabled in beforeEach (the pre-toggle default
// most tests assume). `mock`-prefixed so jest's hoisted factory may close over it.
let mockLinkPreviewsEnabled = true;
jest.mock('@/src/common/link-previews', () => ({
  useLinkPreviews: () => ({
    enabled: mockLinkPreviewsEnabled,
    setEnabled: jest.fn(),
  }),
}));

jest.mock('@polycentric/react-native', () => ({
  COLLECTION: { FEED: 1 },
  types: {},
  v2: {
    EventKey: { create: jest.fn(() => ({})), fromBinary: jest.fn(() => ({})) },
    EventBundle: { create: jest.fn((x: unknown) => x) },
    Content: { toBinary: jest.fn(() => new Uint8Array()) },
    Link: { create: jest.fn((x: unknown) => x) },
  },
}));

jest.mock('@/src/features/feed/hooks/feedCache', () => ({
  injectPostIntoFeedCache: jest.fn(),
  feedQueryKeys: {
    following: () => ['following'],
    identity: (id: string) => ['identity', id],
    explore: (id: string) => ['explore', id],
  },
}));

jest.mock('@/src/features/post/hooks/useThread', () => ({
  injectReplyIntoThreadCache: jest.fn(),
}));

jest.mock('@/src/common/query/hooks/useQuery', () => ({
  invalidateQuery: jest.fn(),
}));

// --- Helpers --------------------------------------------------------------

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockProcess = processAndUploadImage as jest.Mock;

/** A promise whose resolution we control, to model in-flight uploads. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function libraryReturns(
  assets: Array<{ uri: string; width: number; height: number }>,
) {
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets,
    // biome-ignore lint/suspicious/noExplicitAny: test mock cast
  } as any);
}

const onClose = jest.fn();
const onPostCreated = jest.fn();

type ComposerApi = ReturnType<typeof useComposer>;

let renderers: TestRenderer.ReactTestRenderer[] = [];

/**
 * Minimal hook renderer on top of react-test-renderer: `result.current` is
 * captured during render (synchronously), so it's always up to date after an
 * `act()` flush — no effect/async timing to wait on.
 */
const renderComposer = (args = {}) => {
  const result: { current: ComposerApi } = { current: null as never };
  function Probe() {
    result.current = useComposer({ onPostCreated, onClose, ...args });
    return null;
  }
  act(() => {
    renderers.push(TestRenderer.create(React.createElement(Probe)));
  });
  return { result };
};

/** Flush pending microtasks (resolved promises) inside act. */
const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockLinkPreviewsEnabled = true;
  useComposerStore.getState().reset();
  // Default: uploads succeed immediately.
  mockProcess.mockResolvedValue({ images: [] });
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
});

// Unmount any mounted hook between tests so roots don't accumulate.
afterEach(() => {
  act(() => {
    renderers.forEach((r) => {
      r.unmount();
    });
  });
  renderers = [];
});

// --- Tests ----------------------------------------------------------------

describe('useComposer attachments', () => {
  it('adds a picked image immediately in the processing state', async () => {
    libraryReturns([{ uri: 'file://a.jpg', width: 100, height: 80 }]);
    const upload = deferred<{ images: [] }>();
    mockProcess.mockReturnValueOnce(upload.promise);

    const { result } = await renderComposer();

    await act(async () => {
      await result.current.handleAttachImage();
    });

    // Visible right away, still processing while the upload is in flight.
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]).toMatchObject({
      uri: 'file://a.jpg',
      width: 100,
      height: 80,
      status: 'processing',
    });
    expect(processAndUploadImage).toHaveBeenCalledWith(
      mockClient,
      'file://a.jpg',
      expect.objectContaining({ mode: 'fit' }),
    );

    // Flips to ready once the background upload resolves.
    await act(async () => {
      upload.resolve({ images: [] });
    });
    await flush();
    expect(result.current.attachments[0].status).toBe('ready');
  });

  it('marks the attachment as error when processing fails', async () => {
    libraryReturns([{ uri: 'file://a.jpg', width: 100, height: 80 }]);
    mockProcess.mockRejectedValueOnce(new Error('resize failed'));

    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handleAttachImage();
    });

    await flush();
    expect(result.current.attachments[0].status).toBe('error');
  });

  it('dismisses the keyboard before opening the picker', async () => {
    libraryReturns([{ uri: 'file://a.jpg', width: 100, height: 80 }]);
    const { result } = await renderComposer();

    await act(async () => {
      await result.current.handleAttachImage();
    });

    expect(Keyboard.dismiss).toHaveBeenCalled();
  });

  it('never exceeds MAX_ATTACHMENTS and limits the picker selection', async () => {
    // Start with two existing attachments.
    libraryReturns([
      { uri: 'file://a.jpg', width: 10, height: 10 },
      { uri: 'file://b.jpg', width: 10, height: 10 },
    ]);
    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handleAttachImage();
    });
    expect(result.current.attachments).toHaveLength(2);
    // First call: all 4 slots were free.
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 4 }),
    );

    // Returning 3 more only ingests the remaining 2 (caps at 4).
    libraryReturns([
      { uri: 'file://c.jpg', width: 10, height: 10 },
      { uri: 'file://d.jpg', width: 10, height: 10 },
      { uri: 'file://e.jpg', width: 10, height: 10 },
    ]);
    await act(async () => {
      await result.current.handleAttachImage();
    });

    // Second call: told only 2 slots remained.
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 2 }),
    );
    expect(result.current.attachments).toHaveLength(4);
    expect(result.current.attachDisabled).toBe(true);
  });

  it('removes an attachment', async () => {
    libraryReturns([{ uri: 'file://a.jpg', width: 10, height: 10 }]);
    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handleAttachImage();
    });
    const id = result.current.attachments[0].id;

    act(() => result.current.handleRemoveAttachment(id));
    expect(result.current.attachments).toHaveLength(0);
  });

  it('does nothing when the picker is canceled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
    } as any);
    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handleAttachImage();
    });
    expect(result.current.attachments).toHaveLength(0);
    expect(processAndUploadImage).not.toHaveBeenCalled();
  });
});

describe('useComposer camera capture', () => {
  it('sets an error when camera permission is denied', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
    } as any);
    const { result } = await renderComposer();

    await act(async () => {
      await result.current.handleCaptureImage();
    });

    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/camera permission/i);
    expect(result.current.attachments).toHaveLength(0);
  });

  it('ingests a captured photo when permission is granted', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: true,
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
    } as any);
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://shot.jpg', width: 30, height: 40 }],
      // biome-ignore lint/suspicious/noExplicitAny: test mock cast
    } as any);
    const { result } = await renderComposer();

    await act(async () => {
      await result.current.handleCaptureImage();
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].uri).toBe('file://shot.jpg');
  });
});

describe('useComposer canPost', () => {
  it('is false when empty and true once there is text', async () => {
    const { result } = await renderComposer();
    expect(result.current.canPost).toBe(false);

    act(() => result.current.setText('hello'));
    expect(result.current.canPost).toBe(true);
  });
});

describe('useComposer handlePost', () => {
  it('does nothing with no text and no attachments', async () => {
    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handlePost();
    });
    expect(mockClient.contentManager.save).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('posts a text-only draft and closes', async () => {
    const { result } = await renderComposer();
    act(() => result.current.setText('hello world'));

    await act(async () => {
      await result.current.handlePost();
    });

    expect(mockClient.contentManager.build).toHaveBeenCalledWith(
      expect.objectContaining({ oneofKind: 'post' }),
    );
    expect(mockClient.commitEvent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    // Composer was reset.
    expect(result.current.text).toBe('');
    expect(result.current.submitting).toBe(false);
  });

  it('rewrites remembered identity mentions to the curly form', async () => {
    const id = 'a'.repeat(64);
    const { result } = await renderComposer();
    act(() => {
      result.current.setText(`hi @${id} `);
      useComposerStore.getState().rememberMention(id, 'Jane');
    });

    await act(async () => {
      await result.current.handlePost();
    });

    expect(mockClient.contentManager.build).toHaveBeenCalledWith(
      expect.objectContaining({
        post: expect.objectContaining({ text: `hi @{${id},Jane}` }),
      }),
    );
    // Memory is cleared with the rest of the composer.
    expect(useComposerStore.getState().mentions).toEqual({});
  });

  it('awaits the in-flight upload before committing the post', async () => {
    libraryReturns([{ uri: 'file://a.jpg', width: 100, height: 80 }]);
    const upload = deferred<{ images: [] }>();
    mockProcess.mockReturnValueOnce(upload.promise);

    const { result } = await renderComposer();
    await act(async () => {
      await result.current.handleAttachImage();
    });

    // Press Post while the upload is still running (kick it off; the sync
    // state update to `submitting` flushes within act, the promise stays
    // pending on the upload).
    let postPromise!: Promise<void>;
    act(() => {
      postPromise = result.current.handlePost();
    });

    // It should be waiting on the upload, not yet committed.
    expect(mockClient.commitEvent).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(true);

    // Resolve the upload; the post completes.
    await act(async () => {
      upload.resolve({ images: [] });
      await postPromise;
    });

    expect(mockClient.commitEvent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces an error when posting fails', async () => {
    mockClient.commitEvent.mockRejectedValueOnce(new Error('commit boom'));
    const { result } = await renderComposer();
    act(() => result.current.setText('hello'));

    await act(async () => {
      await result.current.handlePost();
    });

    expect(result.current.error).toBe('commit boom');
    expect(result.current.submitting).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useComposer link previews', () => {
  const draftWithUrl = 'check https://example.com out';

  it('embeds a link preview when enabled and the draft has a url', async () => {
    const { result } = await renderComposer();
    act(() => result.current.setText(draftWithUrl));

    await act(async () => {
      await result.current.handlePost();
    });

    expect(mockClient.urlInfo).toHaveBeenCalledWith('https://example.com');
    const built = mockClient.contentManager.build.mock.calls[0][0];
    expect(built.post.links).toHaveLength(1);
  });

  it('drops the stale card as soon as the url is swapped', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderComposer();
      act(() => result.current.setText(draftWithUrl));
      // The loading state waits for the debounced fetch to actually start.
      expect(result.current.linkPreviewLoading).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreview).not.toBeNull();
      expect(result.current.linkPreviewLoading).toBe(false);

      // Swap the url: the stale card disappears right away, before the new
      // fetch (and its loading state) kicks in.
      act(() => result.current.setText('now https://other.example instead'));
      expect(result.current.linkPreview).toBeNull();
      expect(result.current.linkPreviewLoading).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreview).toMatchObject({
        url: 'https://other.example',
      });
      expect(result.current.linkPreviewLoading).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('disables posting until the preview finishes loading', async () => {
    jest.useFakeTimers();
    try {
      const unfurl = deferred<Awaited<ReturnType<typeof mockClient.urlInfo>>>();
      mockClient.urlInfo.mockReturnValueOnce(unfurl.promise);
      const { result } = await renderComposer();
      act(() => result.current.setText(draftWithUrl));

      // Debounce elapses, the fetch starts: posting is held.
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreviewLoading).toBe(true);
      expect(result.current.canPost).toBe(false);

      await act(async () => {
        unfurl.resolve({
          url: 'https://example.com',
          title: 't',
          description: 'd',
          image: 'i',
        });
      });
      expect(result.current.linkPreviewLoading).toBe(false);
      expect(result.current.canPost).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-enables posting when a loading preview is removed', async () => {
    jest.useFakeTimers();
    try {
      // Never resolves: the user removes the preview instead of waiting.
      mockClient.urlInfo.mockReturnValueOnce(new Promise(() => {}));
      const { result } = await renderComposer();
      act(() => result.current.setText(draftWithUrl));

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.canPost).toBe(false);

      act(() => result.current.handleRemoveLinkPreview());
      expect(result.current.linkPreviewLoading).toBe(false);
      expect(result.current.canPost).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('revives previews when a different link is typed after dismissal', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderComposer();
      act(() => result.current.setText(draftWithUrl));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreview).not.toBeNull();

      act(() => result.current.handleRemoveLinkPreview());
      expect(result.current.linkPreview).toBeNull();

      act(() => result.current.setText('now https://other.example instead'));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreview).toMatchObject({
        url: 'https://other.example',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('revives previews when the same link is deleted and retyped', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderComposer();
      act(() => result.current.setText(draftWithUrl));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      act(() => result.current.handleRemoveLinkPreview());
      expect(result.current.linkPreview).toBeNull();

      // Delete the link and let the draft settle: the removal enters the
      // diff baseline, so retyping the very same url counts as newly typed
      // and unfurls again. (Deleting and retyping within one debounce window
      // coalesces into "no change" — the settled diff never sees it.)
      act(() => result.current.setText('check  out'));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      act(() => result.current.setText(draftWithUrl));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.linkPreview).toMatchObject({
        url: 'https://example.com',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops the preview and stops embedding once dismissed', async () => {
    const { result } = await renderComposer();
    act(() => result.current.setText(draftWithUrl));

    act(() => result.current.handleRemoveLinkPreview());
    expect(result.current.linkPreview).toBeNull();
    expect(result.current.linkPreviewLoading).toBe(false);

    await act(async () => {
      await result.current.handlePost();
    });

    expect(mockClient.urlInfo).not.toHaveBeenCalled();
    const built = mockClient.contentManager.build.mock.calls[0][0];
    expect(built.post.links).toHaveLength(0);
  });

  it('skips link preview generation when disabled', async () => {
    mockLinkPreviewsEnabled = false;
    const { result } = await renderComposer();
    act(() => result.current.setText(draftWithUrl));

    // The disabled setting clears any live preview rather than fetching one.
    expect(result.current.linkPreview).toBeNull();

    await act(async () => {
      await result.current.handlePost();
    });

    expect(mockClient.urlInfo).not.toHaveBeenCalled();
    const built = mockClient.contentManager.build.mock.calls[0][0];
    expect(built.post.links).toHaveLength(0);
  });
});

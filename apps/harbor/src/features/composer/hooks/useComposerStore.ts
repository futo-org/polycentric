import { create } from 'zustand';

/**
 * `processing` — being resized/uploaded; `ready` — blobs are on the server;
 * `error` — processing failed (post will retry from scratch).
 */
export type AttachmentStatus = 'processing' | 'ready' | 'error';

export type ComposerAttachment = {
  id: string;
  uri: string;
  width: number;
  height: number;
  status: AttachmentStatus;
};

type ComposerState = {
  text: string;
  attachments: ComposerAttachment[];
  submitting: boolean;
  error: string | null;
  // Mentions inserted this session, identity -> display name
  mentions: Record<string, string>;
};

type ComposerActions = {
  setText: (text: string) => void;
  addAttachments: (additions: ComposerAttachment[]) => void;
  setAttachmentStatus: (id: string, status: AttachmentStatus) => void;
  removeAttachment: (id: string) => void;
  setSubmitting: (value: boolean) => void;
  setError: (error: string | null) => void;
  rememberMention: (identity: string, name: string) => void;
  /** Clear text, attachments, and error. Keeps no draft. */
  reset: () => void;
};

const initialState: ComposerState = {
  text: '',
  attachments: [],
  submitting: false,
  error: null,
  mentions: {},
};

export const useComposerStore = create<ComposerState & ComposerActions>(
  (set) => ({
    ...initialState,
    setText: (text) => set({ text }),
    addAttachments: (additions) =>
      set((s) => ({ attachments: [...s.attachments, ...additions] })),
    setAttachmentStatus: (id, status) =>
      set((s) => ({
        attachments: s.attachments.map((a) =>
          a.id === id ? { ...a, status } : a,
        ),
      })),
    removeAttachment: (id) =>
      set((s) => ({
        attachments: s.attachments.filter((a) => a.id !== id),
      })),
    setSubmitting: (submitting) => set({ submitting }),
    setError: (error) => set({ error }),
    rememberMention: (identity, name) =>
      set((s) => ({ mentions: { ...s.mentions, [identity]: name } })),
    reset: () => set(initialState),
  }),
);

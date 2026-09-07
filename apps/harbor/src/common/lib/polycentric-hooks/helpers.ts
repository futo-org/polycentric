import {
  type LabelSet,
  type PostLabel,
  type QueryStatus,
  v2,
} from '@polycentric/react-native';
import type { UseQueryResult } from '@/src/common/query/hooks/useQuery';

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type PostData = {
  /** Hex of the event key */
  id: string;

  identity: v2.EventKey['identity'];
  signedBy: v2.PublicKey;
  sequence: string;

  content: string;
  createdAt: number;

  /** App that authored the event, if reported. */
  application?: v2.Application;

  /** Attached image sets, in author-provided order. */
  images: v2.ImageSet[];

  /** Attached link previews (Open Graph metadata), in author-provided order. */
  links: v2.Link[];

  /** Set when the underlying `v2.Post` carried a `reply`. */
  reply?: {
    /** Hex of the root post's EventKey — same encoding as `PostData.id`. */
    rootId?: string;
    /** Hex of the parent post's EventKey — same encoding as `PostData.id`. */
    parentId?: string;
  };

  /** Hex of the quoted post's EventKey — same encoding as `PostData.id`. */
  quoteId?: string;

  /** Quoted post resolved from the feed's `event_hints`, when the server
   *  shipped it alongside — lets the quote box render without a fetch. */
  quotePost?: PostData;

  /** Identity that reposted this post, when this item represents a
   *  repost. The rest of the fields are the *reposted* post's data. */
  repostedBy?: string;
  /** Hex of the repost event's own EventKey — used as the feed list
   *  key so a repost is distinct from the original post. */
  repostId?: string;
  /** When the repost was made. Feeds rank a repost by this, so it is the
   *  time the row shows. */
  repostedAt?: number;

  // --- Metadata that may change ---
  // Events and content are immutable, but metadata can be updated over time.
  // We should still create a new PostData object with the updated metadata
  // instead of directly mutating existing objects.

  /** Our estimation for how many replies this post has. */
  replyCount?: number;

  /** Our estimation for how many reactions this post has. */
  totalReactionCount?: number;

  /** Our estimation for how many positive reactions this post has. */
  upvoteCount?: number;

  /** Our estimation for how many negative reactions this post has. */
  downvoteCount?: number;

  /** Our estimation of the per-emoji reaction breakdown, most popular first. */
  reactionTallies?: v2.ReactionTally[];

  // --- End of metadata ---

  signedEvent: v2.SignedEvent;

  /** Labels applied to this post, decoded from event hints. */
  labels?: PostLabel[];
};

export type { LabelSet, PostLabel } from '@polycentric/react-native';

const OWN_APP_ID_PREFIX = 'org.futo.polycentric';

/** The app a post came from; `undefined` for our own builds. */
export function thirdPartyApplication(
  application?: v2.Application,
): { name: string; url?: string } | undefined {
  if (!application || application.id.startsWith(OWN_APP_ID_PREFIX)) {
    return undefined;
  }
  return {
    name: application.name || application.id,
    url: /^https?:\/\//i.test(application.url) ? application.url : undefined,
  };
}

// A key fingerprint is the first 16 characters of the hex bytes of the key contents
// It does not include the key type.
export function getKeyFingerprint(key?: v2.PublicKey): string | undefined {
  if (!key) {
    return undefined;
  }
  return bytesToHex(key.key).substring(0, 16);
}

/** Every `Content.contentBody` variant that carries a payload — i.e. each
 *  `oneofKind` except the empty `undefined` case. */
export type ContentKind = Exclude<
  v2.Content['contentBody']['oneofKind'],
  undefined
>;

/** The payload a given content kind carries. `ContentBodyOf<'follow'>` is
 *  `v2.Follow`, `ContentBodyOf<'post'>` is `v2.Post`, and so on. Inferred
 *  via a mapped type rather than `[K]` indexing, which TS rejects for a
 *  generic key over a discriminated union. */
export type ContentBodyOf<K extends ContentKind> =
  Extract<v2.Content['contentBody'], { oneofKind: K }> extends {
    [P in K]: infer T;
  }
    ? T
    : never;

/** A bundle decoded against a specific content kind: the parsed event, the
 *  content narrowed to that kind's payload type, and the bundle's raw
 *  signed event (validated to be present). */
export type DecodedBundle<K extends ContentKind> = {
  event: v2.Event;
  content: ContentBodyOf<K>;
  signedEvent: v2.SignedEvent;
};

/**
 * Decode an `EventBundle` as a specific content kind, replacing the
 * per-kind `decodeReaction` / `decodeFollow` / `decodePost` helpers.
 *
 * Returns `null` when the bundle is malformed or carries a different kind.
 * The `kind` argument both filters and types the result: the returned
 * `content` is narrowed to that kind's payload, so `decodeBundle(b, 'follow')`
 * yields a `v2.Follow` and `decodeBundle(b, 'post')` a `v2.Post`.
 */
export function decodeBundle<K extends ContentKind>(
  bundle: v2.EventBundle,
  kind: K,
): DecodedBundle<K> | null {
  if (!bundle.signedEvent || !bundle.serializedContent?.contentBytes) {
    return null;
  }
  let parsed: v2.Content;
  let event: v2.Event;
  try {
    parsed = v2.Content.fromBinary(bundle.serializedContent.contentBytes);
    event = v2.Event.fromBinary(bundle.signedEvent.eventBytes);
  } catch {
    return null;
  }
  if (parsed.contentBody.oneofKind !== kind) return null;
  // Safe: the oneofKind check above guarantees `kind` is the live payload
  // key. TS can't index a discriminated union by a generic key, so cast.
  const content = (
    parsed.contentBody as unknown as Record<K, ContentBodyOf<K>>
  )[kind];
  return { event, content, signedEvent: bundle.signedEvent };
}

export function eventKeyId(eventKey: v2.EventKey): string {
  return bytesToHex(v2.EventKey.toBinary(eventKey));
}

/** Decode a v2 EventBundle into PostData, or null if not a post. */
export function decodePostBundle(bundle: v2.EventBundle): PostData | null {
  const decoded = decodeBundle(bundle, 'post');
  if (!decoded) return null;
  try {
    const { event, content: post, signedEvent } = decoded;
    const key = event.key;
    if (!key?.signedBy?.key) return null;

    const id = eventKeyId(key);
    const reply = post.reply
      ? {
          rootId: post.reply.root ? eventKeyId(post.reply.root) : undefined,
          parentId: post.reply.parent
            ? eventKeyId(post.reply.parent)
            : undefined,
        }
      : undefined;
    const quoteId = post.quote ? eventKeyId(post.quote) : undefined;

    return {
      id,
      identity: key.identity,
      signedBy: key.signedBy,
      sequence: key.sequence.toString(),
      content: post.text,
      createdAt: Number(event.createdAt ?? 0),
      application: event.application,
      images: post.images,
      links: post.links,
      reply,
      quoteId,
      replyCount: bundle.meta?.replyCount,
      totalReactionCount: bundle.meta?.reactionCount,
      upvoteCount: bundle.meta?.upvoteCount,
      downvoteCount: bundle.meta?.downvoteCount,
      reactionTallies: bundle.meta?.emojiReactions,
      signedEvent,
    };
  } catch (e) {
    console.warn('[decodePostBundle] drop: decode threw', e);
    return null;
  }
}

/**
 * Convert rs-core `LabelSet`s (collected from a response's `event_hints`)
 * into a mapping from event key id to label values
 */
export function labelMapFromSets(sets: LabelSet[]): Map<string, PostLabel[]> {
  const labelMap = new Map<string, PostLabel[]>();
  for (const set of sets) {
    const target = v2.EventKey.create({
      collection: set.target.collection,
      identity: set.target.identity,
      signedBy: v2.PublicKey.create({
        keyType: set.target.signedBy.keyType,
        key: new Uint8Array(set.target.signedBy.key),
      }),
      sequence: set.target.sequence,
    });
    labelMap.set(eventKeyId(target), set.labels);
  }
  return labelMap;
}

/** A repost event decoded into who reposted, the target post's id, and
 *  the repost event's own id. `null` if the bundle isn't a repost. */
function decodeRepostBundle(bundle: v2.EventBundle): {
  repostedBy: string;
  targetId: string;
  repostId: string;
  repostedAt: number;
} | null {
  const decoded = decodeBundle(bundle, 'repost');
  if (!decoded) return null;
  try {
    const key = decoded.event.key;
    if (!key?.signedBy?.key) return null;
    const target = decoded.content.post;
    if (!target) return null;
    return {
      repostedBy: key.identity,
      targetId: eventKeyId(target),
      repostId: eventKeyId(key),
      repostedAt: Number(decoded.event.createdAt ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Decode a `GetFeedResponse` into renderable posts. Plain posts decode
 * directly; reposts resolve their target post from `event_hints` (the
 * server ships the reposted post alongside) and surface it tagged with
 * `repostedBy`. A repost whose target isn't in the hints is dropped.
 */
export function decodeFeedItems(
  response: v2.GetFeedResponse,
  labelMap: Map<string, PostLabel[]>,
): PostData[] {
  const hintPosts = new Map<string, PostData>();
  for (const hint of response.eventHints) {
    if (!hint.eventBundle) continue;
    const post = decodePostBundle(hint.eventBundle);
    if (post) hintPosts.set(post.id, post);
  }

  const items: PostData[] = [];
  for (const bundle of response.eventBundles) {
    const post = decodePostBundle(bundle);
    if (post) {
      const labels = labelMap.get(post.id);
      if (labels) post.labels = labels;
      items.push(post);
      continue;
    }
    const repost = decodeRepostBundle(bundle);
    if (repost) {
      const target = hintPosts.get(repost.targetId);
      if (target) {
        const repostLabels = labelMap.get(repost.targetId);
        items.push({
          ...target,
          labels: repostLabels ?? target.labels,
          repostedBy: repost.repostedBy,
          repostId: repost.repostId,
          repostedAt: repost.repostedAt,
        });
      }
    }
  }

  for (const item of items) {
    if (item.quoteId) {
      item.quotePost = hintPosts.get(item.quoteId);
    }
  }
  return items;
}

/** Get the forward cursor token from a previous feed query result */
export function extractFeedToken(
  _status: QueryStatus | undefined,
  data: ArrayBuffer | undefined,
): string | undefined {
  let forwardToken: string | undefined;

  if (data) {
    const response = v2.GetFeedResponse.fromBinary(new Uint8Array(data));
    forwardToken = response.pageInfo?.endCursor;
  }

  return forwardToken;
}

/** Check whether it's reasonable to fetch more feed data from servers */
export function shouldExtend(
  hasNextPage: boolean,
  query: UseQueryResult,
): boolean {
  return hasNextPage && query.successfulServers > 0;
}

/**
 * Dicebear identicon URL for a public key.
 */
export function identiconUrl(seed: string, size = 80): string {
  return `https://api.dicebear.com/7.x/identicon/png?seed=${seed}&size=${size}`;
}

/**
 * Pick the smallest image variant at or above `targetSize`. Falls back
 * to the largest available variant if none are big enough. Returns
 * `null` when the set is empty.
 */
export function pickImageVariant(
  imageSet: v2.ImageSet | null | undefined,
  targetSize: number,
): v2.Image | null {
  if (!imageSet || imageSet.images.length === 0) return null;
  const sorted = [...imageSet.images].sort((a, b) => a.width - b.width);
  return (
    sorted.find((img) => img.width >= targetSize) ??
    sorted[sorted.length - 1] ??
    null
  );
}

export function timeAgo(unixMs: number): string {
  if (!unixMs) return '';
  const diff = Date.now() - unixMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(unixMs);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hex of the event key for a bundle — matches `PostData.id` encoding.
 *  Returns `null` if the bundle isn't a well-formed signed event. */
export function bundleEventId(bundle: v2.EventBundle): string | null {
  if (!bundle.signedEvent) return null;
  try {
    const event = v2.Event.fromBinary(bundle.signedEvent.eventBytes);
    if (!event.key) return null;
    return eventKeyId(event.key);
  } catch {
    return null;
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function pubkeyStr(key: v2.PublicKey): string {
  return Array.from(key.key ?? new Uint8Array()).join(',');
}

export function publicKeyToString(key: v2.PublicKey): string {
  const keyType = key.keyType ?? 0;
  const keyBytes = key.key ?? new Uint8Array();
  return `${keyType}_${bytesToHex(keyBytes)}`;
}

export function stringToPublicKey(str: string): v2.PublicKey {
  const idx = str.indexOf('_');
  const keyTypeStr = str.slice(0, idx);
  const keyHex = str.slice(idx + 1);
  return v2.PublicKey.create({
    keyType: Number(keyTypeStr),
    key: hexToBytes(keyHex),
  });
}

export function publicKeyToStringURLSafe(key: v2.PublicKey): string {
  return publicKeyToString(key);
}

export function stringURLSafeToPublicKey(str: string): v2.PublicKey {
  return stringToPublicKey(str);
}

/**
 * @deprecated misnamed — this returns a short base64 form of the signer's
 * public key, not the identity id. Use {@link shortenIdentityId} or render
 * the v2 `key.identity` string directly.
 */
export function getIdentityId(publicKey: v2.PublicKey): string {
  const bytes = publicKey.key ?? new Uint8Array();
  if (bytes.length === 0) return '...';
  return toBase64(bytes).slice(0, 10);
}

export function getIdentityIdShort(publicKey: v2.PublicKey): string {
  return getIdentityId(publicKey).slice(0, 4);
}

/**
 * Short display form of a v2 identity id (hex sha256 of the initial
 * Identity content). Returns a placeholder if the id is empty.
 */
export function shortenIdentityId(
  identity: string | undefined,
  len = 10,
): string {
  if (!identity) return '...';
  return identity.slice(0, len);
}

export function signedEventToHex(signedEvent: v2.SignedEvent): string {
  return bytesToHex(v2.SignedEvent.toBinary(signedEvent));
}

export function hexToSignedEvent(hex: string): v2.SignedEvent {
  return v2.SignedEvent.fromBinary(hexToBytes(hex));
}

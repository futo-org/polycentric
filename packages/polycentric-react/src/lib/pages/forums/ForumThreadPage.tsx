import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { IonContent, IonTextarea } from '@ionic/react';
import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import Long from 'long';
import { Trash2 } from 'lucide-react';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StackRouterContext } from '../../app/contexts';
import { AddServerButton } from '../../components/forums/AddServerButton';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { ProfilePicture } from '../../components/profile/ProfilePicture';
import { Link } from '../../components/util/link';
import { Linkify } from '../../components/util/linkify';
import { useAvatar, useBlobDisplayURL } from '../../hooks/imageHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import {
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from '../../hooks/queryHooks';
import { useParams } from '../../hooks/stackRouterHooks';
import { useAuthHeaders } from '../../hooks/useAuthHeaders';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useIsBanned } from '../../hooks/useIsBanned';

interface QuotedPostSectionProps {
  quotedPost: ForumPost;
}

const QuotedPostSection: React.FC<QuotedPostSectionProps> = ({
  quotedPost,
}) => {
  const quotedAuthorPublicKey = Models.PublicKey.fromProto({
    key: quotedPost.author_id,
    keyType: Long.UONE,
  });
  const quotedUsernameResult = useUsernameCRDTQuery(quotedAuthorPublicKey);
  const quotedUsername = quotedUsernameResult || 'User';
  const quotedShortPublicKey = useTextPublicKey(quotedAuthorPublicKey, 10);
  const quotedAuthorGeneratedLink = useSystemLink(quotedAuthorPublicKey);
  const [quotedAuthorStableLink, setQuotedAuthorStableLink] = useState<
    string | undefined
  >(undefined);

  // Update the stable link for quoted author when available
  useEffect(() => {
    if (
      quotedAuthorGeneratedLink &&
      quotedAuthorGeneratedLink !== quotedAuthorStableLink
    ) {
      setQuotedAuthorStableLink(quotedAuthorGeneratedLink);
    } else if (!quotedAuthorGeneratedLink && quotedAuthorStableLink) {
      setQuotedAuthorStableLink(undefined);
    }
  }, [quotedAuthorGeneratedLink, quotedAuthorStableLink]);

  return (
    <blockquote className="border-l-4 border-gray-300 pl-3 py-2 mb-3 bg-gray-50 rounded-md">
      <div className="text-sm text-gray-600 mb-1">
        Quote by{' '}
        {quotedAuthorStableLink ? (
          <Link
            routerLink={quotedAuthorStableLink}
            className="font-medium hover:underline"
          >
            <span>{quotedUsername}</span>
            {quotedShortPublicKey && (
              <span className="ml-1 text-xs text-gray-500 font-mono">
                {quotedShortPublicKey}
              </span>
            )}
          </Link>
        ) : (
          <span className="font-medium">{quotedUsername}</span>
        )}
      </div>
      <div className="prose prose-sm max-w-none text-gray-800">
        <Linkify as="span" className="" content={quotedPost.content} />
      </div>
    </blockquote>
  );
};

interface ForumThread {
  id: string;
  board_id: string;
  title: string;
  created_at: string;
  created_by: Uint8Array;
}

interface ForumPostImage {
  id: string;
  post_id: string;
  image_url: string;
  created_at: string;
}

interface ForumPost {
  id: string;
  thread_id: string;
  author_id: Uint8Array;
  content: string;
  created_at: string;
  images: ForumPostImage[];
  quote_of?: string;
  polycentric_system_id?: Uint8Array;
  polycentric_process_id?: Uint8Array;
  polycentric_log_seq?: Long;
}

interface PostItemProps {
  post: ForumPost;
  onQuote: (post: ForumPost) => void;
  quotedPost?: ForumPost;
  serverUrl: string | null;
  isAdmin: boolean | undefined;
  currentUserPubKey: Uint8Array | undefined;
  onDelete: (postId: string) => void;
  isDeleting: boolean;
  isBanned?: boolean;
}

const PostItem: React.FC<PostItemProps> = ({
  post,
  onQuote,
  quotedPost,
  serverUrl,
  isAdmin,
  currentUserPubKey,
  onDelete,
  isDeleting,
  isBanned,
}) => {
  const authorPublicKey = Models.PublicKey.fromProto({
    key: post.author_id,
    keyType: Long.UONE,
  });
  const authorAvatarUrl = useAvatar(authorPublicKey);
  const username = useUsernameCRDTQuery(authorPublicKey) || 'User';
  const shortPublicKey = useTextPublicKey(authorPublicKey, 10);
  const postTime = new Date(post.created_at).toLocaleString();
  const postImage =
    post.images && post.images.length > 0 ? post.images[0] : null;

  let displayContent = post.content;
  if (quotedPost) {
    const quotePrefixPattern = `> ${quotedPost.content
      .split('\n')
      .map((line) => (line ? line : ''))
      .join('\n> ')}\n\n`;
    if (post.content.startsWith(quotePrefixPattern)) {
      displayContent = post.content.substring(quotePrefixPattern.length);
    }
  }

  const isAuthor =
    currentUserPubKey && post.author_id
      ? Buffer.from(currentUserPubKey).equals(Buffer.from(post.author_id))
      : false;
  const canDelete = isAdmin || isAuthor;

  const generatedLink = useSystemLink(authorPublicKey);

  const [stableUserLink, setStableUserLink] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (generatedLink && generatedLink !== stableUserLink) {
      setStableUserLink(generatedLink);
    }
  }, [generatedLink, stableUserLink]);

  return (
    <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200 grid grid-cols-[auto_1fr] gap-4">
      <div className="flex flex-col items-center space-y-2 pt-1 w-20 flex-shrink-0">
        <Link
          routerLink={stableUserLink}
          className={`text-center ${
            !stableUserLink
              ? 'pointer-events-none cursor-default opacity-90'
              : 'cursor-pointer'
          }`}
        >
          <ProfilePicture
            src={authorAvatarUrl}
            alt={`${username}'s profile picture`}
            className="h-10 w-10 rounded-full mx-auto"
          />
          <div className="flex flex-col items-center mt-1">
            <span className="text-xs text-center break-words">{username}</span>
            {shortPublicKey && (
              <span className="text-xs text-gray-500 font-mono text-center block w-full mt-0.5">
                {shortPublicKey}
              </span>
            )}
          </div>
        </Link>
      </div>

      <div className="min-w-0">
        <div className="text-xs text-gray-500 mb-2 text-right">{postTime}</div>
        {quotedPost && <QuotedPostSection quotedPost={quotedPost} />}
        <div className="prose max-w-none mb-3">
          <Linkify as="span" className="" content={displayContent} />
        </div>
        {postImage && (
          <div className="my-3">
            <img
              src={
                serverUrl
                  ? `${serverUrl}${postImage.image_url}`
                  : postImage.image_url
              }
              alt={`Image for post ${post.id}`}
              className="max-w-full h-auto rounded-md border border-gray-200"
            />
          </div>
        )}
        <div className="flex justify-end items-center space-x-3 pt-2 border-t border-gray-100 mt-3">
          {canDelete && !isBanned && (
            <button
              onClick={() => onDelete(post.id)}
              disabled={isDeleting}
              className="p-1 text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete Post"
            >
              <Trash2 size={16} />
            </button>
          )}
          {!isBanned && (
            <button
              onClick={() => onQuote(post)}
              disabled={isDeleting}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              title="Quote this post"
            >
              Quote
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const ForumThreadPage: React.FC = () => {
  const {
    serverUrl: encodedServerUrl,
    categoryId,
    boardId,
    threadId,
  } = useParams<{
    serverUrl: string;
    categoryId: string;
    boardId: string;
    threadId: string;
  }>();
  const { processHandle } = useProcessHandleManager();
  const [thread, setThread] = useState<ForumThread | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [newPostBody, setNewPostBody] = useState('');
  const [newPostImage, setNewPostImage] = useState<File | undefined>();
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [quotingPost, setQuotingPost] = useState<ForumPost | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageUrl = useBlobDisplayURL(newPostImage);
  const textareaRef = useRef<HTMLIonTextareaElement>(null);
  const [postToProfile, setPostToProfile] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [deletePostError, setDeletePostError] = useState<string | null>(null);
  const stackRouter = useContext(StackRouterContext);

  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : null;

  const {
    isAdmin,
    loading: adminLoading,
    error: adminError,
  } = useIsAdmin(serverUrl ?? '');
  const {
    fetchHeaders,
    loading: headersLoading,
    error: headersError,
  } = useAuthHeaders(serverUrl ?? '');

  const {
    isBanned,
    loading: banLoading,
    error: banError,
    banReason,
    bannedAt,
  } = useIsBanned(serverUrl ?? '');

  const quotingAuthorPublicKey = quotingPost
    ? Models.PublicKey.fromProto({
        key: Buffer.from(quotingPost.author_id),
        keyType: Long.UONE,
      })
    : undefined;
  const quotingUsernameResult = useUsernameCRDTQuery(quotingAuthorPublicKey);
  const quotingUsernameDisplay = quotingAuthorPublicKey
    ? quotingUsernameResult || 'User'
    : '';

  const polycentricPointer = useMemo(() => {
    if (typeof window === 'undefined') {
      return { systemId: undefined, processId: undefined, logSeq: undefined };
    }
    const queryParams = new URLSearchParams(window.location.search);
    const systemIdB64 = queryParams.get('polycentricSystemId');
    const processIdB64 = queryParams.get('polycentricProcessId');
    const logSeqStr = queryParams.get('polycentricLogSeq');

    let systemId: Uint8Array | undefined = undefined;
    let processId: Uint8Array | undefined = undefined;
    let logSeq: Long | undefined = undefined;

    try {
      if (systemIdB64) systemId = base64.decode(systemIdB64);
      if (processIdB64) processId = base64.decode(processIdB64);
      if (logSeqStr) logSeq = Long.fromString(logSeqStr);
    } catch (e) {
      console.error('Error parsing Polycentric pointer query params:', e);
      return { systemId: undefined, processId: undefined, logSeq: undefined };
    }

    if (systemId && processId && logSeq) {
      return { systemId, processId, logSeq };
    } else {
      return { systemId: undefined, processId: undefined, logSeq: undefined };
    }
  }, []);

  const {
    systemId: polycentricSystemId,
    processId: polycentricProcessId,
    logSeq: polycentricLogSeq,
  } = polycentricPointer;

  const fetchThreadData = useCallback(async () => {
    if (!serverUrl || !threadId) {
      return [];
    }
    setLoading(true);
    setError(null);
    setDeletePostError(null);
    try {
      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;

      const threadDetailsUrl = `${baseUrl}/forum/threads/${threadId}`;
      const threadRes = await fetch(threadDetailsUrl);
      if (threadRes.ok) {
        const fetchedThread: ForumThread = await threadRes.json();
        setThread(fetchedThread);
      } else {
      }

      const postsApiUrl = `${baseUrl}/forum/threads/${threadId}/posts`;
      const postsResponse = await fetch(postsApiUrl);

      if (!postsResponse.ok) {
        throw new Error(
          `Failed to fetch posts: ${postsResponse.status} ${postsResponse.statusText}`,
        );
      }

      let fetchedPosts: ForumPost[] = await postsResponse.json();

      fetchedPosts = fetchedPosts.map((post) => {
        // @ts-ignore - Access the raw author_id which is an array of numbers
        const authorIdArray: number[] = post.author_id || [];
        const authorIdBytes = new Uint8Array(authorIdArray);
        return {
          ...post,
          author_id: authorIdBytes,
        };
      });

      setPosts(fetchedPosts);
      return fetchedPosts;
    } catch (fetchError: unknown) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load thread data.',
      );
      setPosts([]);
      throw fetchError;
    } finally {
      setLoading(false);
    }
  }, [serverUrl, threadId]);

  useEffect(() => {
    fetchThreadData();
  }, [fetchThreadData]);

  const handleQuote = useCallback((postToQuote: ForumPost) => {
    setQuotingPost(postToQuote);
    setIsComposing(true);
    setNewPostBody('');
    setNewPostImage(undefined);
    setPostError(null);
    setDeletePostError(null);
    setTimeout(() => textareaRef.current?.setFocus(), 100);
  }, []);

  const handlePostSubmit = async () => {
    if (!processHandle || !serverUrl || !threadId || !newPostBody.trim()) {
      setPostError('Missing necessary information or post body is empty.');
      return;
    }

    if (newPostBody.trim().length > 10000) {
      setPostError('Post content cannot exceed 10,000 characters.');
      return;
    }

    setIsPosting(true);
    setPostError(null);
    setDeletePostError(null);

    let forumPostId: string | null = null;

    try {
      const challengeUrl = `https://localhost:8080/forum/auth/challenge`;
      const challengeRes = await fetch(challengeUrl);
      if (!challengeRes.ok)
        throw new Error(`Challenge fetch failed: ${challengeRes.statusText}`);
      const { challenge_id, nonce_base64 } = await challengeRes.json();
      const nonce = base64.decode(nonce_base64);

      const privateKey = processHandle.processSecret().system;
      if (!privateKey) throw new Error('Private key unavailable.');
      const signature = await sign(nonce, privateKey.key);

      const pubKey = await Models.PrivateKey.derivePublicKey(privateKey);
      const pubKeyBase64 = base64.encode(pubKey.key);
      const signatureBase64 = base64.encode(signature);
      const headers = {
        'X-Polycentric-Pubkey-Base64': pubKeyBase64,
        'X-Polycentric-Signature-Base64': signatureBase64,
        'X-Polycentric-Challenge-ID': challenge_id,
      };

      const formData = new FormData();
      formData.append('content', newPostBody.trim());
      if (newPostImage)
        formData.append('image', newPostImage, newPostImage.name);
      if (quotingPost) formData.append('quote_of', quotingPost.id);
      if (polycentricSystemId && polycentricProcessId && polycentricLogSeq) {
        const logSeqValue: Long = polycentricLogSeq;
        formData.append(
          'polycentric_system_id',
          base64.encode(polycentricSystemId),
        );
        formData.append(
          'polycentric_process_id',
          base64.encode(polycentricProcessId),
        );
        formData.append('polycentric_log_seq', logSeqValue.toString());
      }

      const createPostUrl = `https://localhost:8080/forum/threads/${threadId}/posts`;
      const createRes = await fetch(createPostUrl, {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      if (!createRes.ok) {
        const errorBody = await createRes.text();
        console.error('Create forum post error:', errorBody);
        throw new Error(
          `Failed to create forum post: ${createRes.status} ${createRes.statusText}`,
        );
      }

      const newForumPost: ForumPost = await createRes.json();
      forumPostId = newForumPost.id; // Store the ID

      if (postToProfile) {
        let polycentricPostPointer: Models.Pointer.Pointer | undefined =
          undefined;
        try {
          const forumLinkPath = `/forums/${encodedServerUrl}/${categoryId}/${boardId}/${threadId}/${forumPostId}`;
          let polycentricContent = '';
          const replyText = newPostBody.trim();
          const linkText = `[View on Forum](${forumLinkPath})`;
          if (quotingPost) {
            const quotedTextFormatted = quotingPost.content
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
            polycentricContent = `${quotedTextFormatted}\n\n${replyText}\n\n${linkText}`;
          } else {
            polycentricContent = `${replyText}\n\n${linkText}`;
          }

          const signedEventResult =
            await processHandle.post(polycentricContent);

          if (signedEventResult) {
            polycentricPostPointer = signedEventResult;
          } else {
            console.warn(
              'processHandle.post did not return the pointer. Cannot link.',
            );
            polycentricPostPointer = undefined;
          }
        } catch (profilePostError: unknown) {
          console.error(
            'Failed to post reply to Polycentric profile:',
            profilePostError,
          );
          setPostError('Reply posted, but failed to post to your profile.');
          polycentricPostPointer = undefined;
        }

        if (forumPostId && polycentricPostPointer && serverUrl) {
          try {
            const linkHeaders = await fetchHeaders();
            if (!linkHeaders)
              throw new Error(
                'Authentication headers unavailable for linking.',
              );

            const linkUrl = `https://localhost:8080/forum/posts/${forumPostId}/link-polycentric`;
            const linkPayload = {
              polycentric_system_id_b64: base64.encode(
                polycentricPostPointer.system.key,
              ),
              polycentric_process_id_b64: base64.encode(
                polycentricPostPointer.process.process,
              ),
              polycentric_log_seq:
                polycentricPostPointer.logicalClock.toNumber(),
            };
            const linkRes = await fetch(linkUrl, {
              method: 'PUT',
              headers: {
                ...linkHeaders,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(linkPayload),
              credentials: 'include',
            });

            if (!linkRes.ok) {
              const linkErrorBody = await linkRes.text();
              console.error('Link post error body:', linkErrorBody);
              throw new Error(
                `Failed to link forum post: ${linkRes.status} ${linkRes.statusText}`,
              );
            }
          } catch (linkError: unknown) {
            console.error(
              'Error linking forum post to Polycentric post:',
              linkError,
            );
            setPostError(
              postError
                ? `${postError} | Link failed: ${
                    linkError instanceof Error
                      ? linkError.message
                      : 'Unknown error'
                  }`
                : `Post created, but failed to link to profile post: ${
                    linkError instanceof Error
                      ? linkError.message
                      : 'Unknown error'
                  }`,
            );
          }
        }
      }

      setNewPostBody('');
      setNewPostImage(undefined);
      setQuotingPost(null);
      setIsComposing(false);
      setPostToProfile(false);
      await fetchThreadData();
    } catch (err: unknown) {
      console.error('Error creating post:', err);
      setPostError(
        err instanceof Error ? err.message : 'An unknown error occurred.',
      );
    } finally {
      setIsPosting(false);
    }
  };

  const handleCancelCompose = () => {
    setIsComposing(false);
    setPostError(null);
    setNewPostBody('');
    setNewPostImage(undefined);
    setQuotingPost(null);
    setPostToProfile(false);
    setDeletePostError(null);
  };

  const handleDeletePost = async (postId: string) => {
    const postForConfirmation = posts.find((p) => p.id === postId);
    const postSnippet = postForConfirmation
      ? `"${postForConfirmation.content.substring(0, 50)}..."`
      : 'this post';
    if (
      !window.confirm(
        `Are you sure you want to delete ${postSnippet}? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingPostId(postId);
    setDeletePostError(null);
    let polycentricDeleteAttempted = false;
    let polycentricDeleteSuccess = true;
    let freshPostData: ForumPost | null = null;
    try {
      const freshDataUrl = `https://localhost:8080/forum/posts/${postId}`;
      const freshDataRes = await fetch(freshDataUrl);
      if (!freshDataRes.ok) {
        const errorText = await freshDataRes.text();
        throw new Error(
          `Failed to fetch fresh post data (${freshDataRes.status}): ${errorText}`,
        );
      }
      freshPostData = await freshDataRes.json();

      if (freshPostData) {
        // @ts-ignore
        const authorIdArray: number[] = freshPostData.author_id || [];
        freshPostData.author_id = new Uint8Array(authorIdArray);

        if (
          typeof freshPostData.polycentric_log_seq === 'number' ||
          typeof freshPostData.polycentric_log_seq === 'string'
        ) {
          try {
            freshPostData.polycentric_log_seq = Long.fromString(
              String(freshPostData.polycentric_log_seq),
            );
          } catch (e: unknown) {
            console.error('Error converting log_seq to Long:', e);
            freshPostData.polycentric_log_seq = undefined;
          }
        } else if (
          freshPostData.polycentric_log_seq &&
          !(freshPostData.polycentric_log_seq instanceof Long)
        ) {
          try {
            const seqObj = freshPostData.polycentric_log_seq as {
              low?: number;
              high?: number;
            };
            if (
              typeof seqObj?.low === 'number' &&
              typeof seqObj?.high === 'number'
            ) {
              freshPostData.polycentric_log_seq = new Long(
                seqObj.low,
                seqObj.high,
                false,
              );
            } else {
              throw new Error('log_seq object missing low/high properties');
            }
          } catch (e: unknown) {
            console.error('Error re-creating log_seq Long from object:', e);
            freshPostData.polycentric_log_seq = undefined;
          }
        } else if (freshPostData.polycentric_log_seq === null) {
          freshPostData.polycentric_log_seq = undefined;
        }
      }

      if (!freshPostData) {
        throw new Error('Could not retrieve post data for deletion checks.');
      }

      const currentUserPubKey = processHandle?.system()?.key;
      const isAuthor =
        currentUserPubKey && freshPostData.author_id
          ? Buffer.from(currentUserPubKey).equals(
              Buffer.from(freshPostData.author_id),
            )
          : false;

      if (
        isAuthor &&
        freshPostData.polycentric_process_id &&
        freshPostData.polycentric_log_seq
      ) {
        polycentricDeleteAttempted = true;
        try {
          if (!processHandle) throw new Error('Process handle unavailable...');
          if (!freshPostData.polycentric_process_id)
            throw new Error('Missing process ID...');
          if (!freshPostData.polycentric_log_seq)
            throw new Error('Missing log sequence...');

          const processToDelete = Models.Process.fromProto({
            process: freshPostData.polycentric_process_id,
          });

          await processHandle.delete(
            processToDelete,
            freshPostData.polycentric_log_seq,
          );
        } catch (polyError: unknown) {
          console.error(
            `Polycentric deletion failed for post ${postId}:`,
            polyError,
          );
          polycentricDeleteSuccess = false;
          setDeletePostError(
            `Forum post deleted, but failed to delete corresponding Polycentric post: ${
              polyError instanceof Error ? polyError.message : 'Unknown error'
            }`,
          );
        }
      }

      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers to delete post.');
      }
      const deleteUrl = `https://localhost:8080/forum/posts/${postId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders },
        credentials: 'include',
      });
      if (!response.ok) {
        let errorText = `Failed to delete forum post (Status: ${response.status})`;
        try {
          errorText = (await response.text()) || errorText;
        } catch (_) {}
        console.error('Forum post deletion error:', errorText);
        if (!polycentricDeleteAttempted || polycentricDeleteSuccess) {
          setDeletePostError(errorText);
        }
        throw new Error(errorText);
      }

      if (polycentricDeleteSuccess) {
        setDeletePostError(null);
      }
      try {
        const postsAfter = await fetchThreadData();
        if (postsAfter.length === 0) {
          stackRouter.setRoot(
            `/forums/${encodeURIComponent(
              serverUrl ?? '',
            )}/${categoryId}/${boardId}`,
            'backwards',
          );
        }
      } catch (fetchErr: unknown) {
        stackRouter.setRoot(
          `/forums/${encodeURIComponent(
            serverUrl ?? '',
          )}/${categoryId}/${boardId}`,
          'backwards',
        );
      }
    } catch (err: unknown) {
      console.error(`Error during deletion process for post ${postId}:`, err);
      if (!polycentricDeleteAttempted || polycentricDeleteSuccess) {
        setDeletePostError(
          err instanceof Error ? err.message : 'Failed to delete post.',
        );
      }
    } finally {
      setDeletingPostId(null);
    }
  };

  const threadTitle = thread
    ? thread.title
    : `Thread ${threadId?.substring(0, 8)}...`;

  const currentUserPubKey = processHandle?.system()?.key;

  const hooksAreLoading =
    !!serverUrl && (adminLoading || headersLoading || banLoading);
  const isBusy = loading || hooksAreLoading || isPosting || !!deletingPostId;
  const hookErrors = !!serverUrl
    ? adminError || headersError || banError
    : null;
  const displayError = error || hookErrors || postError || deletePostError;

  const replyCharCount = newPostBody.length;
  const getCountClass = (count: number, limit: number) => {
    if (count > limit) return 'text-red-500';
    if (count > limit * 0.9) return 'text-yellow-600';
    return 'text-gray-500';
  };

  return (
    <>
      <Header
        canHaveBackButton={true}
        right={<AddServerButton serverUrl={serverUrl} />}
      >
        {threadTitle}
      </Header>
      <IonContent>
        <RightCol
          rightCol={<div />}
          desktopTitle={
            <div className="flex items-center justify-between">
              <span>{threadTitle}</span>
              <AddServerButton serverUrl={serverUrl} />
            </div>
          }
        >
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            {displayError && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
                Error: {displayError}
              </div>
            )}

            {loading && <p>Loading thread...</p>}

            {!loading && !error && posts.length === 0 && (
              <p className="text-gray-500">No posts in this thread yet.</p>
            )}
            {!loading && !error && posts.length > 0 && (
              <div className="space-y-4">
                {posts.map((post) => {
                  const quotedPost = post.quote_of
                    ? posts.find((p) => p.id === post.quote_of)
                    : undefined;
                  return (
                    <PostItem
                      key={post.id}
                      post={post}
                      onQuote={handleQuote}
                      quotedPost={quotedPost}
                      serverUrl={serverUrl}
                      isAdmin={isAdmin}
                      currentUserPubKey={currentUserPubKey}
                      onDelete={handleDeletePost}
                      isDeleting={!!deletingPostId}
                      isBanned={isBanned}
                    />
                  );
                })}
              </div>
            )}

            {!loading && !error && serverUrl && processHandle && (
              <div className="pt-6">
                {isBanned ? (
                  <div className="border p-4 rounded-md bg-red-50 border-red-200 space-y-3">
                    <h3 className="text-lg font-semibold text-red-800">
                      Account Banned
                    </h3>
                    <p className="text-red-700">
                      Your account has been banned from this forum server.
                      {banReason && (
                        <span className="block mt-1">
                          <strong>Reason:</strong> {banReason}
                        </span>
                      )}
                      {bannedAt && (
                        <span className="block mt-1">
                          <strong>Banned on:</strong>{' '}
                          {new Date(bannedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                    <p className="text-red-600 text-sm">
                      You can still read posts but cannot create new posts or
                      replies.
                    </p>
                  </div>
                ) : isComposing ? (
                  <div className="border p-4 rounded-md bg-gray-50 space-y-3">
                    {quotingPost && (
                      <div className="flex justify-between items-center text-sm text-gray-600 p-2 bg-gray-100 rounded-md">
                        <span>
                          Quoting post by{' '}
                          <span className="font-medium">
                            {quotingUsernameDisplay}
                          </span>
                        </span>
                        <button
                          onClick={() => setQuotingPost(null)}
                          className="p-0.5 rounded-full hover:bg-gray-300"
                          title="Remove quote"
                          disabled={isBusy}
                        >
                          <XCircleIcon className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                    )}
                    <h3 className="text-lg font-semibold">Reply to Thread</h3>
                    <IonTextarea
                      ref={textareaRef}
                      value={newPostBody}
                      onIonInput={(e) => setNewPostBody(e.detail.value!)}
                      placeholder="Write your reply..."
                      rows={5}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                      disabled={isBusy}
                    />
                    {newPostImage && imageUrl && (
                      <div className="inline-block relative">
                        <img
                          className="max-h-40 max-w-full rounded-sm border"
                          src={imageUrl}
                          alt="Preview"
                        />
                        <button
                          className="absolute top-1 right-1 bg-black bg-opacity-50 rounded-full p-0.5"
                          onClick={() => setNewPostImage(undefined)}
                          disabled={isBusy}
                        >
                          <XCircleIcon className="w-5 h-5 text-white hover:text-gray-200" />
                        </button>
                      </div>
                    )}

                    {postError && (
                      <p className="text-red-500 text-sm">Error: {postError}</p>
                    )}

                    <div className="flex items-center space-x-2 mt-2">
                      <input
                        type="checkbox"
                        id="postToProfileCheckboxReply"
                        checked={postToProfile}
                        onChange={(e) => setPostToProfile(e.target.checked)}
                        disabled={isBusy}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                      />
                      <label
                        htmlFor="postToProfileCheckboxReply"
                        className="text-sm text-gray-700"
                      >
                        Also post to my Polycentric profile
                      </label>
                    </div>

                    <div className="flex justify-between items-center text-sm mt-1">
                      <span className={getCountClass(replyCharCount, 10000)}>
                        {replyCharCount}/10000
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                          disabled={isBusy || !!newPostImage}
                        >
                          <PhotoIcon className="w-7 h-7" />
                        </button>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          ref={imageInputRef}
                          onChange={(e) => {
                            const { files } = e.target;
                            if (files !== null && files.length > 0) {
                              setNewPostImage(files[0]);
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                      <div className="flex space-x-3">
                        <button
                          onClick={handleCancelCompose}
                          className="px-4 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handlePostSubmit}
                          className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={
                            !newPostBody.trim() ||
                            newPostBody.trim().length > 10000 ||
                            isBusy
                          }
                        >
                          {isPosting ? 'Posting...' : 'Post Reply'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <button
                      onClick={() => setIsComposing(true)}
                      disabled={
                        isBusy ||
                        adminError !== null ||
                        banError !== null ||
                        isBanned ||
                        !processHandle ||
                        !serverUrl
                      }
                      className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        isBanned
                          ? 'You are banned from posting'
                          : 'Post a reply to this thread'
                      }
                    >
                      {isBanned ? 'Post Reply (Banned)' : 'Post Reply'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};

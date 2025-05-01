import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline'; // Import icons
import { IonContent, IonTextarea } from '@ionic/react'; // Import IonTextarea
import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import Long from 'long'; // Import Long
import { Trash2 } from 'lucide-react'; // Added Trash2 icon
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { ProfilePicture } from '../../components/profile/ProfilePicture';
import { Link } from '../../components/util/link';
import { Linkify } from '../../components/util/linkify';
import { useAvatar, useBlobDisplayURL } from '../../hooks/imageHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useSystemLink, useUsernameCRDTQuery } from '../../hooks/queryHooks';
import { useParams } from '../../hooks/stackRouterHooks';
import { useAuthHeaders } from '../../hooks/useAuthHeaders';
import { useIsAdmin } from '../../hooks/useIsAdmin';

// Define types for Thread and Post
interface ForumThread {
  id: string;
  board_id: string;
  title: string;
  created_at: string;
  created_by: Uint8Array; // Assuming raw bytes for pubkey
}

interface ForumPostImage {
  // Define image type based on API response
  id: string;
  post_id: string;
  image_url: string;
  created_at: string;
}

interface ForumPost {
  id: string;
  thread_id: string;
  author_id: Uint8Array; // Assuming raw bytes for pubkey
  content: string;
  created_at: string;
  images: ForumPostImage[]; // Expect an array of image objects
  quote_of?: string; // Add optional quote_of field
  // Add optional Polycentric pointer fields
  polycentric_system_id?: Uint8Array;
  polycentric_process_id?: Uint8Array;
  polycentric_log_seq?: Long;
}

interface PostItemProps {
  post: ForumPost;
  onQuote: (post: ForumPost) => void; // Callback to initiate quoting
  quotedPost?: ForumPost; // Optional: The post being quoted by this post
  serverUrl: string | null; // Add serverUrl prop
  isAdmin: boolean | undefined;
  currentUserPubKey: Uint8Array | undefined;
  onDelete: (postId: string) => void;
  isDeleting: boolean; // Indicate if *any* post is currently being deleted
}

// Component to display a single post
const PostItem: React.FC<PostItemProps> = ({
  post,
  onQuote,
  quotedPost,
  serverUrl,
  isAdmin,
  currentUserPubKey,
  onDelete,
  isDeleting,
}) => {
  const authorPublicKey = Models.PublicKey.fromProto({
    key: post.author_id,
    keyType: Long.UONE,
  });
  const authorAvatarUrl = useAvatar(authorPublicKey);
  const username = useUsernameCRDTQuery(authorPublicKey) || 'User';
  const postTime = new Date(post.created_at).toLocaleString();
  const postImage =
    post.images && post.images.length > 0 ? post.images[0] : null;

  const quotedAuthorPublicKey = quotedPost
    ? Models.PublicKey.fromProto({
        key: quotedPost.author_id,
        keyType: Long.UONE,
      })
    : undefined;
  const quotedUsernameResult = useUsernameCRDTQuery(quotedAuthorPublicKey);
  const quotedUsername = quotedAuthorPublicKey
    ? quotedUsernameResult || 'User'
    : '';

  // Get profile link for quoted author
  const quotedAuthorGeneratedLink = quotedAuthorPublicKey
    ? useSystemLink(quotedAuthorPublicKey)
    : undefined;
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
    }
  }, [quotedAuthorGeneratedLink, quotedAuthorStableLink]);

  // --- Separate Reply Content from Quote Prefix ---
  let displayContent = post.content; // Default to full content
  if (quotedPost) {
    // Reconstruct the expected quote prefix added by handleQuote
    // Note: This relies on the exact format from handleQuote
    const quotePrefixPattern = `> ${quotedPost.content
      .split('\n')
      .map((line) => (line ? line : ''))
      .join('\n> ')}\n\n`;
    if (post.content.startsWith(quotePrefixPattern)) {
      // If the pattern matches, display only the content *after* the prefix
      displayContent = post.content.substring(quotePrefixPattern.length);
    }
    // If the pattern doesn't match (e.g., user edited the quote prefix),
    // we'll fall back to showing the full post.content, which might look odd.
    // A more robust solution might involve backend changes.
  }
  // --- End Separation Logic ---

  // --- Deletion Logic ---
  const isAuthor =
    currentUserPubKey && post.author_id
      ? Buffer.from(currentUserPubKey).equals(Buffer.from(post.author_id))
      : false;
  const canDelete = isAdmin || isAuthor;
  // --- End Deletion Logic ---

  // Get link from hook (which may be undefined initially)
  const generatedLink = useSystemLink(authorPublicKey);

  // Keep track of a stable link value
  const [stableUserLink, setStableUserLink] = useState<string | undefined>(
    undefined,
  );

  // Update the stable link whenever a valid one is generated
  useEffect(() => {
    if (generatedLink && generatedLink !== stableUserLink) {
      setStableUserLink(generatedLink);
    }
  }, [generatedLink, stableUserLink]);

  return (
    <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200 grid grid-cols-[auto_1fr] gap-4">
      {/* Left Column: Author Info */}
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
            className="h-10 w-10 rounded-full"
          />
          <span className="text-xs text-center break-words mt-1">
            {username}
          </span>
        </Link>
      </div>

      {/* Right Column: Post Content & Actions */}
      <div className="min-w-0">
        {/* Timestamp moved to top right */}
        <div className="text-xs text-gray-500 mb-2 text-right">{postTime}</div>
        {/* Existing Quote Block */}
        {quotedPost && (
          <blockquote className="border-l-4 border-gray-300 pl-3 py-2 mb-3 bg-gray-50 rounded-md">
            <div className="text-sm text-gray-600 mb-1">
              Quote by{' '}
              {quotedAuthorStableLink ? (
                <Link
                  routerLink={quotedAuthorStableLink}
                  className="font-medium hover:underline"
                >
                  {quotedUsername}
                </Link>
              ) : (
                <span className="font-medium">{quotedUsername}</span>
              )}
            </div>
            <div className="prose prose-sm max-w-none text-gray-800">
              <Linkify as="span" className="" content={quotedPost.content} />
            </div>
          </blockquote>
        )}
        {/* Existing Post Content */}
        <div className="prose max-w-none mb-3">
          <Linkify as="span" className="" content={displayContent} />
        </div>
        {/* Existing Image Display */}
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
        {/* Actions moved to bottom */}
        <div className="flex justify-end items-center space-x-3 pt-2 border-t border-gray-100 mt-3">
          {canDelete && (
            <button
              onClick={() => onDelete(post.id)}
              disabled={isDeleting}
              className="p-1 text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete Post"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={() => onQuote(post)}
            disabled={isDeleting}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Quote
          </button>
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
  const [thread, setThread] = useState<ForumThread | null>(null); // State for thread details
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [newPostBody, setNewPostBody] = useState('');
  const [newPostImage, setNewPostImage] = useState<File | undefined>(); // Add image state
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [quotingPost, setQuotingPost] = useState<ForumPost | null>(null); // Add state for quoting
  const imageInputRef = useRef<HTMLInputElement>(null); // Ref for file input
  const imageUrl = useBlobDisplayURL(newPostImage); // Hook for preview URL
  const textareaRef = useRef<HTMLIonTextareaElement>(null); // Ref for textarea focus
  const [postToProfile, setPostToProfile] = useState(false); // Add state for checkbox
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [deletePostError, setDeletePostError] = useState<string | null>(null);

  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : null;

  // -- Hooks for Admin/Auth --
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

  // -- quoting username logic --
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

  // --- Get Polycentric Pointer Data from URL Query Params ---
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
  // --- End Pointer Data ---

  const fetchThreadData = useCallback(async () => {
    if (!serverUrl || !threadId) {
      return;
    }
    setLoading(true);
    setError(null);
    setDeletePostError(null); // Clear delete error on refetch
    try {
      // 1. Fetch Thread Details (optional, could get title from first post or list)
      const threadDetailsUrl = `https://localhost:8080/forum/threads/${threadId}`;
      const threadRes = await fetch(threadDetailsUrl);
      if (threadRes.ok) {
        const fetchedThread: ForumThread = await threadRes.json();
        // Convert created_by from base64 string (if needed) or handle bytes directly
        // Example if API returns base64 string:
        // fetchedThread.created_by = base64.decode(fetchedThread.created_by_b64);
        setThread(fetchedThread);
      } else {
        console.warn(
          `Failed to fetch thread details: ${threadRes.status} ${threadRes.statusText}`,
        );
        // Don't block rendering posts if thread fetch fails
      }

      // 2. Fetch Posts
      const postsApiUrl = `https://localhost:8080/forum/threads/${threadId}/posts`;
      const postsResponse = await fetch(postsApiUrl);

      if (!postsResponse.ok) {
        throw new Error(
          `Failed to fetch posts: ${postsResponse.status} ${postsResponse.statusText}`,
        );
      }

      let fetchedPosts: ForumPost[] = await postsResponse.json();

      // Convert the author_id array of numbers into a Uint8Array
      fetchedPosts = fetchedPosts.map((post) => {
        // @ts-ignore - Access the raw author_id which is an array of numbers
        const authorIdArray: number[] = post.author_id || [];
        const authorIdBytes = new Uint8Array(authorIdArray);
        return {
          ...post,
          // Assign the correctly converted Uint8Array
          author_id: authorIdBytes,
        };
      });

      setPosts(fetchedPosts);
    } catch (fetchError: any) {
      console.error('Error fetching thread data:', fetchError);
      setError(fetchError.message || 'Failed to load thread data.');
      setPosts([]); // Clear posts on error
    } finally {
      setLoading(false);
    }
  }, [serverUrl, threadId]);

  useEffect(() => {
    fetchThreadData();
  }, [fetchThreadData]);

  // Function to handle quoting a post
  const handleQuote = useCallback((postToQuote: ForumPost) => {
    setQuotingPost(postToQuote); // Store the post being quoted
    setIsComposing(true); // Open compose area
    // Optionally prefill textarea
    setNewPostBody(''); // Clear the reply body instead of adding quote text
    setNewPostImage(undefined); // Clear any selected image when quoting
    setPostError(null);
    setDeletePostError(null); // Clear delete error when starting quote
    setTimeout(() => textareaRef.current?.setFocus(), 100);
  }, []); // Empty dependency array as it doesn't depend on component state changes

  const handlePostSubmit = async () => {
    if (!processHandle || !serverUrl || !threadId || !newPostBody.trim()) {
      setPostError('Missing necessary information or post body is empty.');
      return;
    }

    setIsPosting(true);
    setPostError(null);
    setDeletePostError(null);

    let forumPostId: string | null = null; // Variable to store the new forum post ID

    try {
      // --- Create Forum Post ---
      // 1. Get Challenge
      const challengeUrl = `https://localhost:8080/forum/auth/challenge`;
      const challengeRes = await fetch(challengeUrl);
      if (!challengeRes.ok)
        throw new Error(`Challenge fetch failed: ${challengeRes.statusText}`);
      const { challenge_id, nonce_base64 } = await challengeRes.json();
      const nonce = base64.decode(nonce_base64);

      // 2. Sign Nonce
      const privateKey = processHandle.processSecret().system;
      if (!privateKey) throw new Error('Private key unavailable.');
      const signature = await sign(nonce, privateKey.key);

      // 3. Prepare Headers
      const pubKey = await Models.PrivateKey.derivePublicKey(privateKey);
      const pubKeyBase64 = base64.encode(pubKey.key);
      const signatureBase64 = base64.encode(signature);
      const headers = {
        'X-Polycentric-Pubkey-Base64': pubKeyBase64,
        'X-Polycentric-Signature-Base64': signatureBase64,
        'X-Polycentric-Challenge-ID': challenge_id,
      };

      // 4. Create FormData Body
      const formData = new FormData();
      formData.append('content', newPostBody.trim());
      if (newPostImage)
        formData.append('image', newPostImage, newPostImage.name);
      if (quotingPost) formData.append('quote_of', quotingPost.id);
      // Add polycentric pointers IF the thread itself was linked (passed via query params)
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

      // 5. POST Request
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

      // --- Polycentric Cross-post & Link ---
      if (postToProfile) {
        let polycentricPostPointer: Models.Pointer.Pointer | undefined =
          undefined;
        try {
          // Construct content for Polycentric
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

          // Create the Polycentric post AND capture the result (assuming it returns Pointer)
          const signedEventResult =
            await processHandle.post(polycentricContent);

          // Assign the result directly if it's the pointer
          if (signedEventResult) {
            polycentricPostPointer = signedEventResult;
          } else {
            console.warn(
              'processHandle.post did not return the pointer. Cannot link.',
            );
            polycentricPostPointer = undefined;
          }
        } catch (profilePostError) {
          console.error(
            'Failed to post reply to Polycentric profile:',
            profilePostError,
          );
          setPostError('Reply posted, but failed to post to your profile.');
          polycentricPostPointer = undefined;
        }

        // --- Link Forum Post to Polycentric Post (if pointer was retrieved) ---
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
          } catch (linkError: any) {
            console.error(
              'Error linking forum post to Polycentric post:',
              linkError,
            );
            setPostError(
              postError
                ? `${postError} | Link failed: ${linkError.message}`
                : `Post created, but failed to link to profile post: ${linkError.message}`,
            );
          }
        }
      }
      // --- End Polycentric Cross-post & Link ---

      // 6. Success
      setNewPostBody('');
      setNewPostImage(undefined); // Corrected function name
      setQuotingPost(null);
      setIsComposing(false);
      setPostToProfile(false);
      await fetchThreadData();
    } catch (err: any) {
      console.error('Error creating post:', err);
      setPostError(err.message || 'An unknown error occurred.');
    } finally {
      setIsPosting(false);
    }
  };

  // Update cancel to also clear quote
  const handleCancelCompose = () => {
    setIsComposing(false);
    setPostError(null);
    setNewPostBody('');
    setNewPostImage(undefined);
    setQuotingPost(null); // Clear quoting state
    setPostToProfile(false); // Reset checkbox on cancel
    setDeletePostError(null); // Clear delete error on cancel compose
  };

  // --- Delete Post Handler (Re-add Debugging) ---
  const handleDeletePost = async (postId: string) => {
    // Use post from state for initial confirmation message only
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
      // --- FETCH FRESH POST DATA ---
      const freshDataUrl = `https://localhost:8080/forum/posts/${postId}`;
      const freshDataRes = await fetch(freshDataUrl);
      if (!freshDataRes.ok) {
        const errorText = await freshDataRes.text();
        throw new Error(
          `Failed to fetch fresh post data (${freshDataRes.status}): ${errorText}`,
        );
      }
      freshPostData = await freshDataRes.json();

      // Convert types
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
          } catch (e) {
            console.error('Error converting log_seq to Long:', e);
            freshPostData.polycentric_log_seq = undefined;
          }
        } else if (
          freshPostData.polycentric_log_seq &&
          !(freshPostData.polycentric_log_seq instanceof Long)
        ) {
          // If it exists but is not Long (e.g., maybe already an object {low, high}), try creating Long from it
          try {
            // Assuming it might be {low, high, unsigned} from JSON parse
            const seqObj = freshPostData.polycentric_log_seq as any;
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
          } catch (e) {
            console.error('Error re-creating log_seq Long from object:', e);
            freshPostData.polycentric_log_seq = undefined;
          }
        } else if (freshPostData.polycentric_log_seq === null) {
          freshPostData.polycentric_log_seq = undefined; // Treat null as undefined
        }
      }

      if (!freshPostData) {
        throw new Error('Could not retrieve post data for deletion checks.');
      }

      // Re-check authorship
      const currentUserPubKey = processHandle?.system()?.key;
      const isAuthor =
        currentUserPubKey && freshPostData.author_id
          ? Buffer.from(currentUserPubKey).equals(
              Buffer.from(freshPostData.author_id),
            )
          : false;

      // 4. Attempt Polycentric Deletion using FRESH data
      if (
        isAuthor &&
        freshPostData.polycentric_process_id &&
        freshPostData.polycentric_log_seq
      ) {
        // Check if logSeq is now a valid Long object

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
            freshPostData.polycentric_log_seq, // Use Long from freshPostData
          );
        } catch (polyError: any) {
          console.error(
            `Polycentric deletion failed for post ${postId}:`,
            polyError,
          );
          polycentricDeleteSuccess = false;
          setDeletePostError(
            `Forum post deleted, but failed to delete corresponding Polycentric post: ${
              polyError.message || 'Unknown error'
            }`,
          );
        }
      }

      // 5. Attempt Forum Post Deletion
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

      // Success
      if (polycentricDeleteSuccess) {
        setDeletePostError(null);
      }
      await fetchThreadData(); // Refetch list after successful forum delete
    } catch (err: any) {
      // Outer error handler: includes errors from fetching fresh data or forum delete
      console.error(`Error during deletion process for post ${postId}:`, err);
      // Avoid overwriting specific Polycentric error if forum delete also failed
      if (!polycentricDeleteAttempted || polycentricDeleteSuccess) {
        setDeletePostError(err.message || 'Failed to delete post.');
      }
    } finally {
      setDeletingPostId(null);
    }
  };
  // --- End Delete Post Handler ---

  const threadTitle = thread
    ? thread.title
    : `Thread ${threadId?.substring(0, 8)}...`;

  // --- Corrected PubKey Access ---
  const currentUserPubKey = processHandle?.system()?.key;

  // Combined loading/busy/error states
  const hooksAreLoading = !!serverUrl && (adminLoading || headersLoading);
  const isBusy = loading || hooksAreLoading || isPosting || !!deletingPostId;
  const hookErrors = !!serverUrl ? adminError || headersError : null;
  const displayError = error || hookErrors || postError || deletePostError;

  return (
    <>
      <Header canHaveBackButton={true}>{threadTitle}</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle={threadTitle}>
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            {/* Unified Error Display */}
            {displayError && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
                Error: {displayError}
              </div>
            )}

            {loading && <p>Loading thread...</p>}

            {/* Post List */}
            {!loading && !error && posts.length === 0 && (
              <p className="text-gray-500">No posts in this thread yet.</p>
            )}
            {!loading && !error && posts.length > 0 && (
              <div className="space-y-4">
                {posts.map((post) => {
                  // Find the post being quoted, if any
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
                    />
                  );
                })}
              </div>
            )}

            {/* Reply/Compose Area */}
            {!loading && !error && serverUrl && processHandle && (
              <div className="pt-6">
                {isComposing ? (
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
                          disabled={!newPostBody.trim() || isBusy}
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
                        !processHandle ||
                        !serverUrl
                      }
                      className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Post Reply
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

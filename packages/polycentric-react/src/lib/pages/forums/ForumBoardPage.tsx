import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { IonContent } from '@ionic/react';
import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import Long from 'long';
import { Trash2 } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useBlobDisplayURL } from '../../hooks/imageHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useParams } from '../../hooks/stackRouterHooks';
import { useAuthHeaders } from '../../hooks/useAuthHeaders';
import { useIsAdmin } from '../../hooks/useIsAdmin';

// Define types for Board and Thread
interface ForumBoard {
  id: string;
  category_id: string;
  name: string;
  description: string;
  created_at: string;
}

interface ForumThread {
  id: string;
  board_id: string;
  title: string;
  created_at: string;
  created_by: number[];
}

// Interface for fetched threads with Uint8Array
interface FetchedForumThread extends Omit<ForumThread, 'created_by'> {
  created_by: Uint8Array;
}

// Add interface for the new Thread creation response
interface CreateThreadResponse {
  thread: FetchedForumThread; // Use existing Fetched type
  initial_post_id: string; // Expect UUID as string
}

// Add a simple CSS override
// const modalStyleOverride = `
//   ion-modal.modal-default.show-modal {
//     pointer-events: auto !important;
//   }
// `;

export const ForumBoardPage: React.FC = () => {
  const {
    serverUrl: encodedServerUrl,
    categoryId,
    boardId,
  } = useParams<{ serverUrl: string; categoryId: string; boardId: string }>();
  const { processHandle } = useProcessHandleManager();
  const [board, setBoard] = useState<ForumBoard | null>(null);
  const [threads, setThreads] = useState<FetchedForumThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [newThreadImage, setNewPostImage] = useState<File | undefined>();
  const [isComposing, setIsComposing] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageUrl = useBlobDisplayURL(newThreadImage);
  const [postToProfile, setPostToProfile] = useState(false);

  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [deleteThreadError, setDeleteThreadError] = useState<string | null>(
    null,
  );

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

  // --- Get Polycentric Pointer Data from URL Query Params ---
  const polycentricPointer = useMemo(() => {
    // Ensure window is defined (for SSR safety, though likely not needed here)
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
      // Reset if any part fails parsing
      return { systemId: undefined, processId: undefined, logSeq: undefined };
    }

    // Return undefined for all if any part is missing (require all or nothing)
    if (systemId && processId && logSeq) {
      return { systemId, processId, logSeq };
    } else {
      return { systemId: undefined, processId: undefined, logSeq: undefined };
    }
  }, []); // Empty dependency array means this runs once on mount

  const {
    systemId: polycentricSystemId,
    processId: polycentricProcessId,
    logSeq: polycentricLogSeq,
  } = polycentricPointer;
  // --- End Pointer Data ---

  const fetchBoardData = useCallback(async () => {
    if (!serverUrl || !boardId) {
      setLoading(false);
      setError(serverUrl ? 'Board ID is missing.' : 'Server URL is missing.');
      setThreads([]);
      return;
    }
    setLoading(true);
    setError(null);
    setDeleteThreadError(null);
    try {
      const boardApiUrl = `https://localhost:8080/forum/boards/${boardId}`;
      const boardResponse = await fetch(boardApiUrl);
      if (!boardResponse.ok) {
        console.error(
          `Failed to fetch board details: ${boardResponse.status} ${boardResponse.statusText}`,
        );
        throw new Error(
          `Failed to fetch board details: ${boardResponse.status} ${boardResponse.statusText}`,
        );
      }
      const fetchedBoard: ForumBoard = await boardResponse.json();
      setBoard(fetchedBoard);

      const threadsApiUrl = `https://localhost:8080/forum/boards/${boardId}/threads`;
      const threadsResponse = await fetch(threadsApiUrl);

      if (!threadsResponse.ok) {
        throw new Error(
          `Failed to fetch threads: ${threadsResponse.status} ${threadsResponse.statusText}`,
        );
      }

      const fetchedThreadsJSON: ForumThread[] = await threadsResponse.json();

      const convertedThreads: FetchedForumThread[] = fetchedThreadsJSON.map(
        (thread) => ({
          ...thread,
          created_by: new Uint8Array(thread.created_by),
        }),
      );

      setThreads(convertedThreads);
    } catch (fetchError: any) {
      console.error('Error fetching board data:', fetchError);
      setError(fetchError.message || 'Failed to load board data.');
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, boardId]);

  useEffect(() => {
    if (serverUrl) {
      fetchBoardData();
    } else {
      setLoading(false);
      setError('Server URL not provided.');
      setThreads([]);
    }
  }, [fetchBoardData, serverUrl]);

  const handleCreateThreadClick = () => {
    setIsComposing(true);
    setNewThreadTitle('');
    setNewThreadBody('');
    setNewPostImage(undefined);
    setCreateError(null);
    setDeleteThreadError(null);
  };

  const handleCreateThreadSubmit = async () => {
    if (
      !processHandle ||
      !serverUrl ||
      !boardId ||
      !newThreadTitle.trim() ||
      !newThreadBody.trim()
    ) {
      setCreateError('Missing necessary information, title, or body.');
      return;
    }
    setIsCreatingThread(true);
    setCreateError(null);
    setDeleteThreadError(null);

    let newForumThreadId: string | null = null;
    let initialForumPostId: string | null = null; // Variable for OP ID

    try {
      const challengeUrl = `https://localhost:8080/forum/auth/challenge`;
      const challengeRes = await fetch(challengeUrl);
      if (!challengeRes.ok) {
        throw new Error(`Failed to get challenge: ${challengeRes.statusText}`);
      }
      const { challenge_id, nonce_base64 } = await challengeRes.json();
      const nonce = base64.decode(nonce_base64);

      const privateKey = processHandle.processSecret().system;
      if (!privateKey) {
        throw new Error('Private key not available via processSecret.');
      }
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
      formData.append('title', newThreadTitle.trim());
      formData.append('content', newThreadBody.trim());
      if (newThreadImage) {
        formData.append('image', newThreadImage, newThreadImage.name);
      }

      // Add Polycentric pointers if available (for linking thread itself, if needed later)
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

      const createThreadUrl = `https://localhost:8080/forum/boards/${boardId}/threads`;
      const createRes = await fetch(createThreadUrl, {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      if (!createRes.ok) {
        const errorBody = await createRes.text();
        console.error('Create thread error response:', errorBody);
        throw new Error(
          `Failed to create thread: ${createRes.status} ${createRes.statusText}`,
        );
      }

      // Expect the new response structure
      const createResponseData: CreateThreadResponse = await createRes.json();
      newForumThreadId = createResponseData.thread.id;
      initialForumPostId = createResponseData.initial_post_id; // Store initial post ID

      // --- Polycentric Cross-post & Link ---
      if (postToProfile) {
        let polycentricPostPointer: Models.Pointer.Pointer | undefined =
          undefined;
        try {
          // Construct content for Polycentric post (using newForumThreadId)
          const forumLinkPath = `/forums/${encodedServerUrl}/${categoryId}/${boardId}/${newForumThreadId}`;
          let polycentricContent = '';
          if (polycentricSystemId) {
            polycentricContent = `Started new forum thread: ${newThreadTitle.trim()}\n\n[View on Forum](${forumLinkPath})`;
          } else {
            polycentricContent = `${newThreadTitle.trim()}\n\n${newThreadBody.trim()}\n\n[View on Forum](${forumLinkPath})`;
          }

          // Create Polycentric post and get pointer
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
        } catch (profilePostError) {
          console.error(
            'Failed to post to Polycentric profile:',
            profilePostError,
          );
          setCreateError(
            'Thread created, but failed to post to your profile. Please try posting manually.',
          );
        }

        // --- Link Initial Forum Post to Polycentric Post ---
        if (initialForumPostId && polycentricPostPointer && serverUrl) {
          try {
            console.log(
              `Linking initial forum post ${initialForumPostId} to Polycentric pointer:`,
              polycentricPostPointer,
            );
            const linkHeaders = await fetchHeaders();
            if (!linkHeaders)
              throw new Error(
                'Authentication headers unavailable for linking.',
              );

            const linkUrl = `https://localhost:8080/forum/posts/${initialForumPostId}/link-polycentric`;

            // --- Construct the payload correctly ---
            const linkPayload = {
              polycentric_system_id_b64: base64.encode(
                polycentricPostPointer.system.key,
              ),
              polycentric_process_id_b64: base64.encode(
                polycentricPostPointer.process.process,
              ),
              polycentric_log_seq:
                polycentricPostPointer.logicalClock.toNumber(), // Send as number
            };
            // --- End Construct Payload ---

            console.log(`Attempting PUT request to: ${linkUrl}`);
            console.log('With Payload:', JSON.stringify(linkPayload));

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
              const errorBody = await linkRes.text();
              console.error('Link error response:', errorBody);
              throw new Error(
                `Failed to link initial post: ${linkRes.status} ${linkRes.statusText}`,
              );
            }
          } catch (linkError: any) {
            console.error(
              'Error linking initial forum post to Polycentric post:',
              linkError,
            );
            setCreateError(
              linkError.message?.includes('Failed to get challenge')
                ? 'Failed to authenticate request. Please try again.'
                : linkError.message || 'Failed to link initial post.',
            );
          }
        } else {
          // Log if linking skipped
          console.log('Skipping linking step for initial post. Conditions:', {
            hasInitialPostId: !!initialForumPostId,
            hasPointer: !!polycentricPostPointer,
            hasServerUrl: !!serverUrl,
          });
        }
      }
      // --- End Polycentric Cross-post & Link ---

      // Success
      setIsComposing(false);
      setNewThreadTitle('');
      setNewThreadBody('');
      setNewPostImage(undefined);
      setPostToProfile(false);
      await fetchBoardData();
    } catch (err: any) {
      console.error('Error creating thread:', err);
      setCreateError(
        err.message?.includes('Failed to get challenge')
          ? 'Failed to authenticate request. Please try again.'
          : err.message ||
              'An unknown error occurred while creating the thread.',
      );
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleCancelCompose = () => {
    setIsComposing(false);
    setCreateError(null);
    setNewThreadTitle('');
    setNewThreadBody('');
    setNewPostImage(undefined);
    setPostToProfile(false);
    setDeleteThreadError(null);
  };

  const handleDeleteThread = async (threadId: string, threadTitle: string) => {
    if (!serverUrl || typeof fetchHeaders !== 'function') {
      setDeleteThreadError(
        'Cannot delete thread: Missing URL or authentication function.',
      );
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to delete the thread "${threadTitle}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingThreadId(threadId);
    setDeleteThreadError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error(
          'Could not get authentication headers to delete thread.',
        );
      }

      const deleteUrl = `https://localhost:8080/forum/threads/${threadId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { ...authHeaders },
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = `Failed to delete thread (Status: ${response.status})`;
        try {
          errorText = (await response.text()) || errorText;
        } catch (_) {}
        throw new Error(errorText);
      }

      await fetchBoardData();
    } catch (err: any) {
      console.error(`Error deleting thread ${threadId}:`, err);
      setDeleteThreadError(err.message || 'Failed to delete thread.');
    } finally {
      setDeletingThreadId(null);
    }
  };

  const boardName = board ? board.name : `Board ${boardId?.substring(0, 8)}...`;

  const currentUserPubKey = processHandle?.system()?.key;

  const hooksAreLoading = !!serverUrl && (adminLoading || headersLoading);
  const isBusy =
    loading || hooksAreLoading || isCreatingThread || !!deletingThreadId;

  const hookErrors = !!serverUrl ? adminError || headersError : null;
  const displayError = error || hookErrors || createError || deleteThreadError;

  return (
    <>
      <Header canHaveBackButton={true}>{boardName}</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle={boardName}>
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            {displayError && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
                Error: {displayError}
              </div>
            )}

            {!isComposing && serverUrl && processHandle && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={handleCreateThreadClick}
                  disabled={isBusy || adminError !== null}
                  className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create New Thread
                </button>
              </div>
            )}

            {isComposing && (
              <div className="border p-4 rounded-md bg-gray-50 mb-4 space-y-3">
                <h3 className="text-lg font-semibold">Create New Thread</h3>
                <div>
                  <label
                    htmlFor="threadTitle"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Title
                  </label>
                  <input
                    type="text"
                    id="threadTitle"
                    value={newThreadTitle}
                    onChange={(e) => setNewThreadTitle(e.target.value)}
                    placeholder="Enter thread title"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    disabled={isBusy}
                  />
                </div>
                <div>
                  <label
                    htmlFor="threadBody"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Body
                  </label>
                  <textarea
                    id="threadBody"
                    rows={5}
                    value={newThreadBody}
                    onChange={(e) => setNewThreadBody(e.target.value)}
                    placeholder="Enter the first post content..."
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    disabled={isBusy}
                  />
                </div>

                {newThreadImage && imageUrl && (
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

                <div className="flex items-center space-x-2 mt-2">
                  <input
                    type="checkbox"
                    id="postToProfileCheckboxThread"
                    checked={postToProfile}
                    onChange={(e) => setPostToProfile(e.target.checked)}
                    disabled={isBusy}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <label
                    htmlFor="postToProfileCheckboxThread"
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
                      disabled={isBusy || !!newThreadImage}
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
                      onClick={handleCreateThreadSubmit}
                      className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={
                        !newThreadTitle.trim() ||
                        !newThreadBody.trim() ||
                        isBusy
                      }
                    >
                      {isCreatingThread ? 'Posting...' : 'Post Thread'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loading && <p>Loading threads...</p>}
            {!loading &&
              !error &&
              (threads.length === 0 ? (
                <p className="text-gray-500">
                  No threads found in this board yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {threads.map((thread) => {
                    const isAuthor =
                      currentUserPubKey && thread.created_by
                        ? Buffer.from(currentUserPubKey).equals(
                            Buffer.from(thread.created_by),
                          )
                        : false;
                    const canDelete = !!serverUrl && (isAdmin || isAuthor);
                    const isCurrentlyDeleting = deletingThreadId === thread.id;
                    return (
                      <li
                        key={thread.id}
                        className="border rounded-md hover:bg-gray-50 transition-colors flex justify-between items-center"
                      >
                        <Link
                          routerLink={`/forums/${encodedServerUrl}/${categoryId}/${boardId}/${thread.id}`}
                          className="block group p-3 flex-grow"
                        >
                          <h4 className="font-semibold text-blue-700 group-hover:underline">
                            {thread.title}
                          </h4>
                          <p className="text-xs text-gray-500">
                            Created:{' '}
                            {new Date(thread.created_at).toLocaleString()}
                          </p>
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() =>
                              handleDeleteThread(thread.id, thread.title)
                            }
                            disabled={isBusy}
                            className="p-2 mr-2 text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete Thread"
                          >
                            {isCurrentlyDeleting ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500"></div>
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};

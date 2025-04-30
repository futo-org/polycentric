import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { IonContent } from '@ionic/react';
import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Link } from '../../components/util/link';
import { useBlobDisplayURL } from '../../hooks/imageHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useParams } from '../../hooks/stackRouterHooks';

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
  // Add other relevant fields like author, last post time, etc. if needed
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
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [newThreadImage, setNewThreadImage] = useState<File | undefined>();
  const [isComposing, setIsComposing] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageUrl = useBlobDisplayURL(newThreadImage);
  const [postToProfile, setPostToProfile] = useState(false);

  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : null;

  const fetchBoardData = useCallback(async () => {
    if (!serverUrl || !boardId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch board details first
      const boardApiUrl = `https://localhost:8080/forum/boards/${boardId}`;
      const boardResponse = await fetch(boardApiUrl);
      if (!boardResponse.ok) {
        // Handle error fetching board details, maybe set a specific error or log
        console.error(
          `Failed to fetch board details: ${boardResponse.status} ${boardResponse.statusText}`,
        );
        // Optionally throw an error to stop execution or continue to fetch threads
        throw new Error(
          `Failed to fetch board details: ${boardResponse.status} ${boardResponse.statusText}`,
        );
      }
      const fetchedBoard: ForumBoard = await boardResponse.json();
      setBoard(fetchedBoard); // Set the board state

      // Then fetch threads for the board
      const threadsApiUrl = `https://localhost:8080/forum/boards/${boardId}/threads`;
      const threadsResponse = await fetch(threadsApiUrl);

      if (!threadsResponse.ok) {
        throw new Error(
          `Failed to fetch threads: ${threadsResponse.status} ${threadsResponse.statusText}`,
        );
      }

      const fetchedThreads: ForumThread[] = await threadsResponse.json();
      setThreads(fetchedThreads);
    } catch (fetchError: any) {
      console.error('Error fetching board data:', fetchError);
      setError(fetchError.message || 'Failed to load board data.');
      setThreads([]); // Clear threads on error
    } finally {
      setLoading(false);
    }
  }, [serverUrl, boardId]);

  useEffect(() => {
    fetchBoardData();
  }, [fetchBoardData]);

  const handleCreateThreadClick = () => {
    setIsComposing(true);
    setNewThreadTitle('');
    setNewThreadBody('');
    setNewThreadImage(undefined);
    setCreateError(null);
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

    try {
      // 1. Get Challenge
      const challengeUrl = `https://localhost:8080/forum/auth/challenge`;
      const challengeRes = await fetch(challengeUrl);
      if (!challengeRes.ok) {
        throw new Error(`Failed to get challenge: ${challengeRes.statusText}`);
      }
      const { challenge_id, nonce_base64 } = await challengeRes.json();
      const nonce = base64.decode(nonce_base64);

      // 2. Sign Nonce
      const privateKey = processHandle.processSecret().system;
      if (!privateKey) {
        throw new Error('Private key not available via processSecret.');
      }
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
      formData.append('title', newThreadTitle.trim());
      formData.append('content', newThreadBody.trim());
      if (newThreadImage) {
        formData.append('image', newThreadImage, newThreadImage.name);
      }

      // 5. POST Request with FormData
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

      // --- Start Polycentric Cross-post ---
      // Get the new thread ID from the response
      const newThread: ForumThread = await createRes.json();

      if (postToProfile) {
        try {
          // Construct the path using the ENCODED serverUrl for the route parameter
          const forumLinkPath = `/forums/${encodedServerUrl}/${categoryId}/${boardId}/${newThread.id}`;
          // Use Markdown link syntax
          const polycentricContent = `${newThreadTitle.trim()}\n\n${newThreadBody.trim()}\n\n[View on Forum](${forumLinkPath})`;

          console.log(
            'Attempting to post to Polycentric profile:',
            polycentricContent,
          );
          await processHandle.post(polycentricContent); // Post text only for now
          console.log('Successfully posted to Polycentric profile.');
          // Optional: Add a success notification for the user
        } catch (profilePostError) {
          console.error(
            'Failed to post to Polycentric profile:',
            profilePostError,
          );
          // IMPORTANT: Don't re-throw; the forum post succeeded. Just inform the user.
          // Update UI or use a toast notification to show this secondary error
          setCreateError(
            'Thread created, but failed to post to your profile. Please try posting manually.',
          );
          // Note: The main createError state is reused here, which might be slightly confusing
          // if the original create operation also failed earlier. Consider a separate state for profile post errors.
        }
      }
      // --- End Polycentric Cross-post ---

      // 6. Success (Clear form, fetch data)
      setIsComposing(false);
      setNewThreadTitle('');
      setNewThreadBody('');
      setNewThreadImage(undefined);
      setPostToProfile(false);
      await fetchBoardData();
    } catch (err: any) {
      console.error('Error creating thread:', err);
      setCreateError(err.message || 'An unknown error occurred.');
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleCancelCompose = () => {
    setIsComposing(false);
    setCreateError(null);
    setNewThreadTitle('');
    setNewThreadBody('');
    setNewThreadImage(undefined);
    setPostToProfile(false);
  };

  const boardName = board ? board.name : `Board ${boardId?.substring(0, 8)}...`;

  return (
    <>
      <Header canHaveBackButton={true}>{boardName}</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle={boardName}>
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            {!isComposing && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={handleCreateThreadClick}
                  disabled={loading || !processHandle}
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
                    disabled={isCreatingThread}
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
                    disabled={isCreatingThread}
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
                      onClick={() => setNewThreadImage(undefined)}
                      disabled={isCreatingThread}
                    >
                      <XCircleIcon className="w-5 h-5 text-white hover:text-gray-200" />
                    </button>
                  </div>
                )}

                {createError && (
                  <p className="text-red-500 text-sm">Error: {createError}</p>
                )}

                <div className="flex items-center space-x-2 mt-2">
                  <input
                    type="checkbox"
                    id="postToProfileCheckboxThread"
                    checked={postToProfile}
                    onChange={(e) => setPostToProfile(e.target.checked)}
                    disabled={isCreatingThread}
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
                      disabled={isCreatingThread || !!newThreadImage}
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
                          setNewThreadImage(files[0]);
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>
                  <div className="flex space-x-3">
                    <button
                      onClick={handleCancelCompose}
                      className="px-4 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                      disabled={isCreatingThread}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateThreadSubmit}
                      className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={
                        !newThreadTitle.trim() ||
                        !newThreadBody.trim() ||
                        isCreatingThread
                      }
                    >
                      {isCreatingThread ? 'Posting...' : 'Post Thread'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loading && <p>Loading threads...</p>}
            {error && <p className="text-red-500">Error: {error}</p>}
            {!loading &&
              !error &&
              (threads.length === 0 ? (
                <p className="text-gray-500">
                  No threads found in this board yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {threads.map((thread) => (
                    <li
                      key={thread.id}
                      className="border rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <Link
                        routerLink={`/forums/${encodedServerUrl}/${categoryId}/${boardId}/${thread.id}`}
                        className="block group p-3"
                      >
                        <h4 className="font-semibold text-blue-700 group-hover:underline">
                          {thread.title}
                        </h4>
                        <p className="text-xs text-gray-500">
                          Created:{' '}
                          {new Date(thread.created_at).toLocaleString()}
                          {/* TODO: Add author info or post count here later */}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};

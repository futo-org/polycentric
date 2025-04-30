import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline'; // Import icons
import { IonContent, IonTextarea } from '@ionic/react'; // Import IonTextarea
import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import Long from 'long'; // Import Long
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { Linkify } from '../../components/util/linkify';
import { useBlobDisplayURL } from '../../hooks/imageHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useUsernameCRDTQuery } from '../../hooks/queryHooks';
import { useParams } from '../../hooks/stackRouterHooks';

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
}

interface PostItemProps {
  post: ForumPost;
  onQuote: (post: ForumPost) => void; // Callback to initiate quoting
  quotedPost?: ForumPost; // Optional: The post being quoted by this post
  serverUrl: string | null; // Add serverUrl prop
}

// Component to display a single post
const PostItem: React.FC<PostItemProps> = ({
  post,
  onQuote,
  quotedPost,
  serverUrl,
}) => {
  const authorPublicKey = Models.PublicKey.fromProto({
    key: post.author_id,
    keyType: Long.UONE,
  });
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

  return (
    <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200">
      <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
        <span>
          Posted by <span className="font-medium">{username}</span>
        </span>
        <span>{postTime}</span>
      </div>
      {/* Display quoted post if it exists */}{' '}
      {quotedPost && (
        <blockquote className="border-l-4 border-gray-300 pl-3 py-2 mb-3 bg-gray-50 rounded-md">
          <div className="text-sm text-gray-600 mb-1">
            Quote by <span className="font-medium">{quotedUsername}</span>
          </div>
          {/* Render the quoted content safely */}{' '}
          <div className="prose prose-sm max-w-none text-gray-800">
            <Linkify
              as="span" // Use appropriate wrapper element
              className="" // Add necessary classes
              content={quotedPost.content}
            />
          </div>
        </blockquote>
      )}
      {/* Display post content (only the reply part if it was a quote) */}
      <div className="prose max-w-none mb-3">
        <Linkify
          as="span" // Use appropriate wrapper element
          className="" // Add necessary classes
          content={displayContent} // Use the separated content
        />
      </div>
      {/* Display post image if it exists */}{' '}
      {postImage && (
        <div className="my-3">
          <img
            // Prepend the correct server base URL (passed as prop) to the relative image_url
            src={
              serverUrl
                ? `${serverUrl}${postImage.image_url}`
                : postImage.image_url
            } // Handle null serverUrl
            alt={`Image for post ${post.id}`}
            className="max-w-full h-auto rounded-md border border-gray-200"
            // TODO: Consider adding error handling or placeholder for broken images
          />
        </div>
      )}
      {/* Action buttons */}{' '}
      <div className="flex justify-end space-x-3">
        <button
          onClick={() => onQuote(post)}
          className="text-sm text-blue-600 hover:underline"
        >
          Quote
        </button>
        {/* Add other actions like reply, report, etc. if needed */}{' '}
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

  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : null;

  // --- Add hook call for quoting user here ---
  const quotingAuthorPublicKey = quotingPost
    ? Models.PublicKey.fromProto({
        key: Buffer.from(quotingPost.author_id),
        keyType: Long.UONE,
      })
    : undefined;
  const quotingUsernameResult = useUsernameCRDTQuery(quotingAuthorPublicKey); // Call hook unconditionally
  const quotingUsernameDisplay = quotingAuthorPublicKey
    ? quotingUsernameResult || 'User'
    : ''; // Determine display name
  // --- End added hook call ---

  const fetchThreadData = useCallback(async () => {
    if (!serverUrl || !threadId) {
      return;
    }
    setLoading(true);
    setError(null);
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
    // Focus textarea after a short delay to ensure it's visible
    setTimeout(() => textareaRef.current?.setFocus(), 100);
  }, []); // Empty dependency array as it doesn't depend on component state changes

  const handlePostSubmit = async () => {
    if (!processHandle || !serverUrl || !threadId || !newPostBody.trim()) {
      setPostError('Missing necessary information or post body is empty.');
      return;
    }

    setIsPosting(true);
    setPostError(null);

    try {
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

      // 3. Prepare Headers (Remove Content-Type)
      const pubKey = await Models.PrivateKey.derivePublicKey(privateKey);
      const pubKeyBase64 = base64.encode(pubKey.key);
      const signatureBase64 = base64.encode(signature);
      const headers = {
        // 'Content-Type': 'application/json', // Let browser set Content-Type for FormData
        'X-Polycentric-Pubkey-Base64': pubKeyBase64,
        'X-Polycentric-Signature-Base64': signatureBase64,
        'X-Polycentric-Challenge-ID': challenge_id,
      };

      // 4. Create FormData Body
      const formData = new FormData();
      formData.append('content', newPostBody.trim());
      if (newPostImage) {
        formData.append('image', newPostImage, newPostImage.name);
      }
      // Add quote_of if quotingPost is set
      if (quotingPost) {
        formData.append('quote_of', quotingPost.id);
      }

      // 5. POST Request with FormData
      const createPostUrl = `https://localhost:8080/forum/threads/${threadId}/posts`;
      const createRes = await fetch(createPostUrl, {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      if (!createRes.ok) {
        const errorBody = await createRes.text();
        console.error('Create post error:', errorBody);
        throw new Error(
          `Failed to create post: ${createRes.status} ${createRes.statusText}`,
        );
      }

      // --- Start Polycentric Cross-post ---
      // Get the new post ID from the response
      const newPost: ForumPost = await createRes.json();

      if (postToProfile) {
        try {
          // Construct the link back to the new post
          const forumLinkPath = `/forums/${encodedServerUrl}/${categoryId}/${boardId}/${threadId}/${newPost.id}`;

          let polycentricContent = '';
          const replyText = newPostBody.trim();
          const linkText = `[View on Forum](${forumLinkPath})`;

          if (quotingPost) {
            // Format the quoted text with '> ' prefix for Polycentric post
            const quotedTextFormatted = quotingPost.content
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n');
            polycentricContent = `${quotedTextFormatted}\n\n${replyText}\n\n${linkText}`;
          } else {
            // Standard reply, no quote prefix needed
            polycentricContent = `${replyText}\n\n${linkText}`;
          }

          console.log(
            'Attempting to post reply to Polycentric profile:',
            polycentricContent,
          );
          await processHandle.post(polycentricContent); // Post text only
          console.log('Successfully posted reply to Polycentric profile.');
          // Optional: Add a success notification
        } catch (profilePostError) {
          console.error(
            'Failed to post reply to Polycentric profile:',
            profilePostError,
          );
          // Set error, but don't block success flow for the forum post
          setPostError(
            'Reply posted, but failed to post to your profile. Please try posting manually.',
          );
        }
      }
      // --- End Polycentric Cross-post ---

      // 6. Success
      setNewPostBody('');
      setNewPostImage(undefined);
      setQuotingPost(null); // Clear quote on successful post
      setIsComposing(false);
      setPostToProfile(false); // Reset checkbox
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
  };

  const threadTitle = thread
    ? thread.title
    : `Thread ${threadId?.substring(0, 8)}...`;

  return (
    <>
      <Header canHaveBackButton={true}>{threadTitle}</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle={threadTitle}>
          <div className="p-5 md:p-10 flex flex-col space-y-4">
            {loading && <p>Loading thread...</p>}
            {error && <p className="text-red-500">Error: {error}</p>}
            {/* Post List */}{' '}
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
                      quotedPost={quotedPost} // Pass the found quoted post data
                      serverUrl={serverUrl} // Pass serverUrl down
                    />
                  );
                })}
              </div>
            )}
            {/* Reply/Compose Area */}{' '}
            {!loading && !error && (
              <div className="pt-6">
                {isComposing ? (
                  <div className="border p-4 rounded-md bg-gray-50 space-y-3">
                    {/* Show quoting indicator */}{' '}
                    {quotingPost && (
                      <div className="flex justify-between items-center text-sm text-gray-600 p-2 bg-gray-100 rounded-md">
                        <span>
                          {/* Use the pre-fetched username */}
                          Quoting post by{' '}
                          <span className="font-medium">
                            {quotingUsernameDisplay}
                          </span>
                        </span>
                        <button
                          onClick={() => setQuotingPost(null)}
                          className="p-0.5 rounded-full hover:bg-gray-300"
                          title="Remove quote"
                        >
                          <XCircleIcon className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                    )}
                    <h3 className="text-lg font-semibold">Reply to Thread</h3>
                    <IonTextarea
                      ref={textareaRef} // Assign ref
                      value={newPostBody}
                      onIonInput={(e) => setNewPostBody(e.detail.value!)}
                      placeholder="Write your reply..."
                      rows={5}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                      disabled={isPosting}
                    />
                    {/* Image Preview */}{' '}
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
                          disabled={isPosting}
                        >
                          <XCircleIcon className="w-5 h-5 text-white hover:text-gray-200" />
                        </button>
                      </div>
                    )}
                    {postError && (
                      <p className="text-red-500 text-sm">Error: {postError}</p>
                    )}
                    {/* Add Checkbox Here */}
                    <div className="flex items-center space-x-2 mt-2">
                      <input
                        type="checkbox"
                        id="postToProfileCheckboxReply"
                        checked={postToProfile}
                        onChange={(e) => setPostToProfile(e.target.checked)}
                        disabled={isPosting}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                      />
                      <label
                        htmlFor="postToProfileCheckboxReply"
                        className="text-sm text-gray-700"
                      >
                        Also post to my Polycentric profile
                      </label>
                    </div>
                    {/* Action Buttons Row */}{' '}
                    <div className="flex justify-between items-center pt-2">
                      {/* Upload Button */}{' '}
                      <div>
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                          disabled={isPosting || !!newPostImage}
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
                      {/* Cancel/Post Buttons */}{' '}
                      <div className="flex space-x-3">
                        <button
                          onClick={handleCancelCompose}
                          className="px-4 py-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                          disabled={isPosting}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handlePostSubmit}
                          className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={
                            !newPostBody.trim() || isPosting || !processHandle
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
                      disabled={!processHandle} // Disable if not signed in
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

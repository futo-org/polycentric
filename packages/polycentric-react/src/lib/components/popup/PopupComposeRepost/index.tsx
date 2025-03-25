import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { FeedItem } from '../../../hooks/feedHooks';
import { useAvatar } from '../../../hooks/imageHooks';
import {
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery
} from '../../../hooks/queryHooks';
import { PurePost } from '../../feed/Post/PurePost';

// Let's create a simplified version of the dialog
export const RepostDialog = ({
  open,
  setOpen,
  originalPost,
  onSubmit,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  originalPost: FeedItem;
  onSubmit: (content: string, attachment?: File) => void;
}) => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extract content safely from the original post
  const postContent = 'content' in originalPost.value 
    ? originalPost.value.content
    : 'claimType' in originalPost.value
      ? `Claim: ${originalPost.value.claimFields?.[0]?.value || ''}`
      : 'Vouch';

  const { event } = originalPost;
  const originalAuthor = useUsernameCRDTQuery(event.system);
  const originalAvatar = useAvatar(event.system);
  const originalUrl = useSystemLink(event.system);
  const originalPubkey = useTextPublicKey(event.system, 10);

  const handleSubmit = async () => {
    if (content.trim() === '') return;
    
    setIsSubmitting(true);
    try {
      onSubmit(content);
      setContent('');
      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-3xl rounded-xl bg-white p-6 w-full">
            <div className="flex justify-between items-center mb-4">
              <Dialog.Title className="text-lg font-medium">
                Repost with Comment
              </Dialog.Title>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-4">
              {/* Simple textarea instead of PostCompose */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Add a comment to your repost..."
                className="w-full p-3 border rounded-md"
                rows={3}
              />
            </div>

            <div className="border rounded-xl p-2 mb-4 bg-gray-50">
              <div className="text-sm text-gray-500 mb-2 font-medium">Reposting:</div>
              <div className="border-l-4 border-gray-300 pl-3">
                <PurePost
                  main={{
                    content: postContent || '',
                    author: {
                      name: originalAuthor || '',
                      avatarURL: originalAvatar || '',
                      URL: originalUrl || '',
                      pubkey: originalPubkey || '',
                    },
                    type: 'post',
                  }}
                  doesLink={false}
                  actions={{
                    like: () => {},
                    dislike: () => {},
                    neutralopinion: () => {},
                    repost: () => {},
                    comment: async () => false
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || content.trim() === ''}
                className="bg-blue-600 text-white px-4 py-2 rounded-md disabled:bg-gray-300"
              >
                {isSubmitting ? 'Posting...' : 'Repost'}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </div>
    </Dialog>
  );
}; 
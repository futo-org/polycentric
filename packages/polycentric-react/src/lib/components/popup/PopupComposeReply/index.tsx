/**
 * @fileoverview Popup compose reply components for modal comment creation.
 */

import { useCallback } from 'react';
import { useIsMobile } from '../../../hooks/styleHooks';
import { Compose } from '../../feed/Compose';
import { ProfilePicture } from '../../profile/ProfilePicture';
import { Modal } from '../../util/modal';

interface PopupComposeReplyProfile {
  name?: string;
  avatarURL?: string;
}

// Reply compose with post context display and thread visualization
export const PopupComposeReply = ({
  main,
  sub,
  onComment,
}: {
  main: {
    content: string;
    publishedAt?: Date;
    author: PopupComposeReplyProfile;
    topic?: string;
  };
  sub?: {
    content: string;
    publishedAt?: Date;
    author: PopupComposeReplyProfile;
    topic: string;
    ContentLink?: string;
  };
  onComment: (content: string, upload?: File) => Promise<boolean>;
}) => {
  const isMobile = useIsMobile();

  return (
    <div className="py-5 md:px-7 md:pb-10 bg-white flex flex-col space-y-0 w-auto md:w-[40rem] h-full">
      <div className="flex relative overflow-clip flex-grow">
        <div className="mr-3 md:mr-4 flex-shrink-0 flex flex-col">
          <ProfilePicture
            src={main.author.avatarURL}
            className="h-16 w-16 md:h-20 md:w-20"
          />
          <div
            className={`flex-grow flex justify-center items-center ${
              sub != null ? 'py-3' : 'py-2'
            }`}
          >
            <div
              className={`border h-full ${
                sub != null ? 'h-full' : 'min-h-[2rem]'
              }`}
            ></div>
          </div>
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex w-full justify-between">
            <div className="font-bold text-md w-full overflow-hidden text-ellipsis">
              {main.author.name}
            </div>
            {/* <div className="pr-3 md:pr-0 font-light text-gray-500">{dateToAgoString(main.publishedAt)}</div> */}
          </div>
          <div className=" text-purple-400 w-full overflow-hidden text-ellipsis">
            {main.topic}
          </div>
          <div className="flex flex-col space-y-3">
            {/* Actual post content */}
            <main
              className={
                'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal break-words text-pretty line-clamp-[7]'
              }
            >
              {main.content}
            </main>
            {/* sub.post */}
            {sub && (
              <div className="pb-3">
                <div className="border rounded-2xl w-full p-5 bg-white flex flex-col space-y-3">
                  <div className="flex">
                    <ProfilePicture
                      src={sub.author.avatarURL}
                      className="h-5 w-5 md:h-10 md:w-10"
                    />
                    <div className="flex flex-col ml-2 w-full">
                      <div className="flex justify-between w-full">
                        <div className="font-bold">{sub.author.name}</div>
                        <div className="pr-3 md:pr-0 font-light text-gray-500 text-sm">
                          {/* {dateToAgoString(sub.publishedAt)} */}
                        </div>
                      </div>
                      <div className=" text-purple-400 leading-3 text-sm">
                        {sub.topic}
                      </div>
                    </div>
                  </div>
                  <main className={`line-clamp-[4]`}>{sub.content}</main>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Compose
        hideTopic={true}
        minTextboxHeightPx={200}
        maxTextboxHeightPx={isMobile ? 200 : 250}
        topicDisabled={true}
        preSetTopic={main.topic}
        onPost={onComment}
      />
    </div>
  );
};

// Fullscreen modal reply compose with auto-close on success
export const PopupComposeReplyFullscreen = ({
  main,
  sub,
  open,
  setOpen,
  onComment,
}: {
  main: {
    content: string;
    publishedAt?: Date;
    author: PopupComposeReplyProfile;
    topic?: string;
  };
  sub?: {
    content: string;
    publishedAt?: Date;
    author: PopupComposeReplyProfile;
    topic: string;
    ContentLink?: string;
  };
  open: boolean;
  setOpen: (b: boolean) => void;
  onComment?: (content: string, upload?: File) => Promise<boolean>;
}) => {
  const onCommentWithClose = useCallback(
    async (content: string, upload?: File) => {
      try {
        await onComment?.(content, upload);
        setOpen(false);
        return true;
      } catch (e) {
        return false;
      }
    },
    [onComment, setOpen],
  );
  return (
    <Modal open={open} setOpen={setOpen}>
      <PopupComposeReply main={main} sub={sub} onComment={onCommentWithClose} />
    </Modal>
  );
};

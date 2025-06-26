import {
  EyeSlashIcon as EyeSlashIconOutlined,
  PencilSquareIcon,
  StarIcon as StarIconOutlined,
} from '@heroicons/react/24/outline';
import {
  EyeSlashIcon as EyeSlashIconSolid,
  StarIcon as StarIconSolid,
} from '@heroicons/react/24/solid';
import { IonContent } from '@ionic/react';
import { Models, Util } from '@polycentric/polycentric-core';
import { useEffect, useMemo, useState } from 'react';
import { Page } from '../../app/routes';
import { PopupComposeFullscreen } from '../../components';
import { PostCompose } from '../../components/feed/Compose/PostCompose';
import { Header } from '../../components/layout/header';
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol';
import { useTopicFeed } from '../../hooks/feedHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useQueryIfAdded } from '../../hooks/queryHooks';
import { useParams } from '../../hooks/stackRouterHooks';
import { useIsMobile } from '../../hooks/styleHooks';
import { TopFeedVideo } from './TopFeedVideo';
import { shittyTestIfYoutubeIDRegex, youtubeURLRegex } from './platformRegex';

function isValidURL(str: string) {
  try {
    new URL(str);
    return true;
  } catch (_) {
    return false;
  }
}

const wwwDotRegex = /^www\./;
const httpsRegex = /^http(?:s|):\/\//;

export const TopicFeedPage: Page = () => {
  const params = useParams<{ 0: string }>();
  const escapedTopic = params[0];
  const isMobile = useIsMobile();
  const [composeModalOpen, setComposeModalOpen] = useState(false);

  const topic: string = useMemo(() => {
    return decodeURIComponent(escapedTopic);
  }, [escapedTopic]);

  const displayTopic = useMemo(() => {
    let displayTopic = topic;
    if (httpsRegex.test(displayTopic)) {
      displayTopic = displayTopic.replace(httpsRegex, '');
    }
    if (wwwDotRegex.test(displayTopic)) {
      displayTopic = displayTopic.replace(wwwDotRegex, '');
    }
    return displayTopic;
  }, [topic]);

  const alternativeTopicRepresentations = useMemo(() => {
    switch (true) {
      case youtubeURLRegex.test(topic): {
        // return video id
        const youtubeMatch = topic.match(youtubeURLRegex);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const youtubeID = youtubeMatch![1];
        return [youtubeID];
      }
      case shittyTestIfYoutubeIDRegex.test(topic): {
        return [`https://www.youtube.com/watch?v=${topic}`];
      }
    }
  }, [topic]);

  const [posts, advancePosts] = useTopicFeed(
    topic,
    alternativeTopicRepresentations,
  );

  const { processHandle } = useProcessHandleManager();
  const encodedTopic = useMemo(() => Util.encodeText(topic), [topic]);
  const joinedTopicInitially = useQueryIfAdded(
    Models.ContentType.ContentTypeJoinTopic,
    processHandle.system(),
    encodedTopic,
  );

  const blockedTopicInitially = useQueryIfAdded(
    Models.ContentType.ContentTypeBlockTopic,
    processHandle.system(),
    encodedTopic,
  );

  const [topicJoined, setTopicJoined] = useState(false);
  const [topicBlocked, setTopicBlocked] = useState(false);

  useEffect(() => {
    setTopicJoined(joinedTopicInitially ?? false);
    setTopicBlocked(blockedTopicInitially ?? false);
  }, [joinedTopicInitially, blockedTopicInitially]);

  const topicSelectButton = useMemo(
    () => (
      <button
        className={`w-12 h-12 rounded-full flex items-center justify-center ${
          topicJoined === true ? 'bg-blue-300 text-blue-50' : 'bg-blue-100'
        }`}
        onClick={() => {
          if (topicJoined === true) {
            processHandle.leaveTopic(topic).then(() => {
              setTopicJoined(false);
            });
          } else {
            // Ensure the topic is not blocked
            const unblockPromise = topicBlocked
              ? processHandle.unblockTopic(topic).then(() => {
                  setTopicBlocked(false);
                })
              : Promise.resolve();

            unblockPromise.then(() => {
              processHandle.joinTopic(topic).then(() => {
                setTopicJoined(true);
              });
            });
          }
        }}
      >
        {topicJoined === true ? (
          <StarIconSolid className="w-6 h-6" />
        ) : (
          <StarIconOutlined className="w-6 h-6" />
        )}
      </button>
    ),
    [topic, topicJoined, processHandle, topicBlocked],
  );

  const topicBlockButton = useMemo(
    () => (
      <button
        className={`w-12 h-12 rounded-full flex items-center justify-center ${
          topicBlocked === true ? 'bg-red-300 text-red-50' : 'bg-red-100'
        }`}
        onClick={() => {
          if (topicBlocked === true) {
            processHandle.unblockTopic(topic).then(() => {
              setTopicBlocked(false);
            });
          } else {
            // If topic is currently a favorite, remove it first to make mutually exclusive
            const leavePromise = topicJoined
              ? processHandle.leaveTopic(topic).then(() => {
                  setTopicJoined(false);
                })
              : Promise.resolve();

            leavePromise.then(() => {
              processHandle.blockTopic(topic).then(() => {
                setTopicBlocked(true);
              });
            });
          }
        }}
      >
        {topicBlocked === true ? (
          <EyeSlashIconSolid className="w-6 h-6" />
        ) : (
          <EyeSlashIconOutlined className="w-6 h-6" />
        )}
      </button>
    ),
    [topic, topicBlocked, processHandle, topicJoined],
  );

  const topComponent = useMemo(() => {
    const isTopicURL = isValidURL(topic);

    const desktopTitleBar = (
      <div className="w-full h-16 text-center flex justify-between items-center flex-row-reverse xl:flex-row border-b px-5">
        <div className="w-12" />
        {isTopicURL ? (
          // Open in new tab
          <a
            className="text-lg text-gray-800"
            href={topic}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h1 className="text-lg text-gray-800">{topic}</h1>
          </a>
        ) : (
          <h1 className="text-lg text-gray-800">{topic}</h1>
        )}
        <div className="flex space-x-2">
          {topicBlockButton}
          {topicSelectButton}
        </div>
      </div>
    );

    return (
      <div className="w-full bg-white">
        {isMobile === false && desktopTitleBar}
        <TopFeedVideo topic={topic} />
        {isMobile === false && <PostCompose preSetTopic={topic} />}
      </div>
    );
  }, [topic, isMobile, topicSelectButton, topicBlockButton]);

  return (
    <>
      <Header>
        <div className="w-full flex justify-between items-center">
          <div className="" />
          <div>{displayTopic}</div>
          <div className="flex space-x-2">
            {topicBlockButton}
            {topicSelectButton}
          </div>
        </div>
      </Header>

      <IonContent>
        <InfiniteScrollWithRightCol
          data={posts}
          advanceFeed={advancePosts}
          topFeedComponent={topComponent}
          topFeedComponentSticky={isMobile}
          rightCol={<div />}
        />
        {isMobile && (
          <>
            <div className="relative z-50">
              <button
                onClick={() => setComposeModalOpen(true)}
                className="fixed bottom-4 right-4 w-16 h-16 bg-blue-500 rounded-full flex justify-center items-center z-50"
              >
                <PencilSquareIcon className="w-8 h-8 text-white" />
              </button>
            </div>
            <PopupComposeFullscreen
              open={composeModalOpen}
              setOpen={setComposeModalOpen}
              preSetTopic={topic}
            />
          </>
        )}
      </IonContent>
    </>
  );
};

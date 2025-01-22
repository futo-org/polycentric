import { StarIcon as StarIconOutlined } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { IonContent } from '@ionic/react';
import { Models, Util } from '@polycentric/polycentric-core';
import { useEffect, useMemo, useState } from 'react';
import { Page } from '../../app/router';
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

    const [topicJoined, setTopicJoined] = useState(false);

    useEffect(() => {
        setTopicJoined(joinedTopicInitially ?? false);
    }, [joinedTopicInitially]);

    const topicSelectButton = useMemo(
        () => (
            <button
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    topicJoined === true
                        ? 'bg-blue-300 text-blue-50'
                        : 'bg-blue-100'
                }`}
                onClick={() => {
                    if (topicJoined === true) {
                        processHandle.leaveTopic(topic).then(() => {
                            setTopicJoined(false);
                        });
                    } else {
                        processHandle.joinTopic(topic).then(() => {
                            setTopicJoined(true);
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
        [topic, topicJoined, processHandle],
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
                {topicSelectButton}
            </div>
        );

        return (
            <div className="w-full bg-white">
                {isMobile === false && desktopTitleBar}
                <TopFeedVideo topic={topic} />
                {isMobile === false && <PostCompose preSetTopic={topic} />}
            </div>
        );
    }, [topic, isMobile, topicSelectButton]);

    return (
        <>
            {/* Mobile only */}
            <Header>
                <div className="w-full flex justify-between items-center">
                    <div className="" />
                    <div>{displayTopic}</div>
                    {topicSelectButton}
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
            </IonContent>
        </>
    );
};

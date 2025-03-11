import { decode } from '@borderless/base64';
import { IonContent } from '@ionic/react';
import { Models, Protocol } from '@polycentric/polycentric-core';
import { useMemo, useState } from 'react';
import { Page } from '../../app/router';
import { PostCompose } from '../../components/feed/Compose/PostCompose';
import { Header } from '../../components/layout/header';
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol';
import { MobileProfileFeed } from '../../components/profile/mobilefeedprofile';
import { UserColumn } from '../../components/profile/sidebarprofile/UserColumn';
import { useAuthorFeed, useLikesFeed } from '../../hooks/feedHooks';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';
import { useTextPublicKey, useUsernameCRDTQuery } from '../../hooks/queryHooks';
import { useParams } from '../../hooks/stackRouterHooks';
import { useIsMobile } from '../../hooks/styleHooks';

export const UserFeedPage: Page = () => {
  const { urlInfoString } = useParams<{ urlInfoString: string }>();
  const { processHandle } = useProcessHandleManager();
  const [currentTab, setCurrentTab] = useState<'posts' | 'likes'>('posts');

  const { system } = useMemo(() => {
    const urlInfoBuffer = decode(urlInfoString);
    const urlInfo = Protocol.URLInfo.decode(urlInfoBuffer);
    const { system, servers } = Models.URLInfo.getSystemLink(urlInfo);
    servers.forEach((server) => {
      processHandle.addAddressHint(system, server);
    });
    return { system, servers };
  }, [urlInfoString, processHandle]);

  const [posts, advancePosts, allPostsAttempted] = useAuthorFeed(system);
  const [likes, advanceLikes, allLikesLoaded] = useLikesFeed(system);

  const column = useMemo(
    () => <UserColumn system={system} key="usercol" />,
    [system],
  );

  const isMobile = useIsMobile();
  const isMyProfile = useMemo(
    () => Models.PublicKey.equal(system, processHandle.system()),
    [system, processHandle],
  );

  const username = useUsernameCRDTQuery(system);
  const headerText = useMemo(() => {
    if (!username) return 'Profile';
    return `${username}'s Profile`;
  }, [username]);

  const stringKey = useTextPublicKey(system);

  const topComponent = useMemo(() => {
    if (isMobile) return <MobileProfileFeed system={system} key={stringKey} />;
    return isMyProfile ? <PostCompose key="topfeedcompose" /> : undefined;
  }, [isMobile, isMyProfile, system, stringKey]);

  const getCurrentFeedData = () => {
    switch (currentTab) {
      case 'likes':
        return {
          data: likes,
          advanceFeed: advanceLikes,
          nothingFound: allLikesLoaded && likes.length === 0,
          nothingFoundMessage: 'No liked posts found',
        };
      default:
        return {
          data: posts,
          advanceFeed: advancePosts,
          nothingFound: allPostsAttempted && posts.length === 0,
          nothingFoundMessage: 'Nothing has been posted yet',
        };
    }
  };

  const feedData = getCurrentFeedData();

  return (
    <>
      <Header>{headerText}</Header>
      <IonContent>
        <InfiniteScrollWithRightCol
          data={feedData.data}
          advanceFeed={feedData.advanceFeed}
          nothingFound={feedData.nothingFound}
          nothingFoundMessage={feedData.nothingFoundMessage}
          rightCol={column}
          topFeedComponent={
            <>
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                  {['posts', 'likes'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setCurrentTab(tab as 'posts' | 'likes')}
                      className={`
                        whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                        ${
                          currentTab === tab
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500'
                        }
                      `}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </nav>
              </div>
              {topComponent}
            </>
          }
        />
      </IonContent>
    </>
  );
};

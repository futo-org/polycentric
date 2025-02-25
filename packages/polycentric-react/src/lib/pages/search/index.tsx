import { IonContent } from '@ionic/react';
import { Page } from '../../app/router';
import { Header } from '../../components/layout/header';
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol';
import { useSearchPostsFeed } from '../../hooks/feedHooks';
import { useParams } from '../../hooks/stackRouterHooks';

const ValidSearchFeed = ({ checkedQuery }: { checkedQuery: string }) => {
  const [data, advanceFeed, nothingFound] = useSearchPostsFeed(checkedQuery);

  return (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      nothingFound={nothingFound}
      rightCol={<div></div>}
      loadingSpinnerN={4}
    />
  );
};

const InvalidSearchFeed = () => {
  return (
    <InfiniteScrollWithRightCol
      data={[]}
      advanceFeed={() => {}}
      rightCol={<div></div>}
    />
  );
};

const SearchFeed = ({ query }: { query: string }) => {
  const validQuery = query && query.length >= 3;

  return validQuery ? (
    <ValidSearchFeed checkedQuery={query} />
  ) : (
    <InvalidSearchFeed />
  );
};

export const SearchPage: Page = () => {
  const { query } = useParams<{ query: string }>();

  return (
    <>
      <Header>Search</Header>

      <IonContent>
        <SearchFeed query={query} />
      </IonContent>
    </>
  );
};

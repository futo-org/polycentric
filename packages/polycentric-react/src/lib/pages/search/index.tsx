/**
 * @fileoverview Search results page with query validation and post feed display.
 */

import { IonContent } from '@ionic/react';
import { Page } from '../../app/routes';
import { Header } from '../../components/layout/header';
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol';
import { useSearchPostsFeed } from '../../hooks/feedHooks';
import { useParams } from '../../hooks/stackRouterHooks';

// Valid search feed with post results and infinite scroll
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

// Invalid search feed with empty state for queries under 3 characters
const InvalidSearchFeed = () => {
  return (
    <InfiniteScrollWithRightCol
      data={[]}
      advanceFeed={() => {}}
      rightCol={<div></div>}
    />
  );
};

// Search feed with query validation and conditional rendering
const SearchFeed = ({ query }: { query: string }) => {
  const validQuery = query && query.length >= 3;

  return validQuery ? (
    <ValidSearchFeed checkedQuery={query} />
  ) : (
    <InvalidSearchFeed />
  );
};

// Search page with query parameter extraction and feed display
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

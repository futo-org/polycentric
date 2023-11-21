import { IonContent } from '@ionic/react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useSearchFeed } from '../../hooks/feedHooks'
import { useParams } from '../../hooks/stackRouterHooks'

const ValidSearchFeed = ({ checkedQuery }: { checkedQuery: string }) => {
  const [data, advanceFeed] = useSearchFeed(checkedQuery)

  return <InfiniteScrollWithRightCol data={data} advanceFeed={advanceFeed} leftCol={<div></div>} />
}

const InvalidSearchFeed = () => {
  return <InfiniteScrollWithRightCol data={[]} advanceFeed={() => {}} leftCol={<div></div>} />
}

const SearchFeed = ({ query }: { query: string }) => {
  const validQuery = query && query.length >= 3

  return validQuery ? <ValidSearchFeed checkedQuery={query} /> : <InvalidSearchFeed />
}

export const SearchPage: Page = () => {
  const { query } = useParams<{ query: string }>()

  return (
    <>
      <Header>Search</Header>

      <IonContent>
        <SearchFeed query={query} />
      </IonContent>
    </>
  )
}

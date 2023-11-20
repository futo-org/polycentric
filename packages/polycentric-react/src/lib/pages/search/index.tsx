import { IonContent } from '@ionic/react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useSearchFeed } from '../../hooks/feedHooks'
import { useParams } from '../../hooks/stackRouterHooks'

export const SearchPage: Page = () => {
  const { query } = useParams<{ query: string }>()

  const [data, advanceFeed] = useSearchFeed(query)

  return (
    <>
      <Header>Search</Header>

      <IonContent>
        <InfiniteScrollWithRightCol data={data} advanceFeed={advanceFeed} leftCol={<div></div>} />
      </IonContent>
    </>
  )
}

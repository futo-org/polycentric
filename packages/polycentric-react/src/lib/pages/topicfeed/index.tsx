import { IonContent } from '@ionic/react'
import { useMemo } from 'react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useTopicFeed } from '../../hooks/feedHooks'
import { useParams } from '../../hooks/stackRouterHooks'
import { TopFeedVideo } from './TopFeedVideo'
import { shittyTestIfYoutubeIDRegex, youtubeURLRegex } from './platformRegex'

function isValidURL(str: string) {
  try {
    new URL(str)
    return true
  } catch (_) {
    return false
  }
}

export const TopicFeedPage: Page = () => {
  const params = useParams<{ 0: string }>()
  const unescapedTopic = params[0]

  const topic: string = useMemo(() => {
    if (unescapedTopic.startsWith('-')) {
      return unescapedTopic.slice(1)
    } else {
      return unescapedTopic
    }
  }, [unescapedTopic])

  const topComponent = useMemo(() => {
    const isTopicURL = isValidURL(topic)
    return (
      <div className="w-full">
        <div className="w-full h-16 text-center flex justify-center items-center border-b">
          {isTopicURL ? (
            // Open in new tab
            <a className="text-lg text-gray-800" href={topic} target="_blank" rel="noopener noreferrer">
              <h1 className="text-lg text-gray-800">{topic}</h1>
            </a>
          ) : (
            <h1 className="text-lg text-gray-800">{topic}</h1>
          )}
        </div>
        <TopFeedVideo topic={topic} />
      </div>
    )
  }, [topic])

  const alternativeTopicRepresentations = useMemo(() => {
    switch (true) {
      case youtubeURLRegex.test(topic): {
        // return video id
        const youtubeMatch = topic.match(youtubeURLRegex)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const youtubeID = youtubeMatch![1]
        return [youtubeID]
      }
      case shittyTestIfYoutubeIDRegex.test(topic): {
        return [`https://www.youtube.com/watch?v=${topic}`]
      }
    }
  }, [topic])

  const [comments, advanceComments] = useTopicFeed(topic, alternativeTopicRepresentations)

  return (
    <>
      <Header>{topic}</Header>

      <IonContent>
        <InfiniteScrollWithRightCol
          data={comments}
          advanceFeed={advanceComments}
          topFeedComponent={topComponent}
          leftCol={<div />}
        />
      </IonContent>
    </>
  )
}

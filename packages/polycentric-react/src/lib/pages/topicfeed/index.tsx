import { IonContent } from '@ionic/react'
import { useMemo, useState } from 'react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useTopicFeed } from '../../hooks/feedHooks'
import { useParams } from '../../hooks/stackRouterHooks'

const shittyTestIfYouTubeID = /([a-zA-Z0-9_-]{11})/

const TopFeedYoutubeEmbed = ({ id }: { id: string }) => {
  const [acceptedThirdParty, setAcceptedThirdParty] = useState(false)
  return (
    <div
      className={`aspect-video w-full flex flex-col justify-center items-center space-y-3 ${
        acceptedThirdParty ? 'sticky top-0 z-50' : ''
      }`}
    >
      {acceptedThirdParty ? (
        <iframe
          width="100%"
          height="auto"
          className="aspect-video"
          src={`https://www.youtube.com/embed/${id}`}
          title="YouTube video player"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <>
          <h3 className="max-w-[30rem]">
            {
              "This video is hosted on YouTube. By clicking play, you agree to YouTube's privacy policy and sending Google data."
            }
          </h3>
          <button
            onClick={() => setAcceptedThirdParty(true)}
            className="px-3 py-2 border rounded-full hover:bg-gray-50"
          >
            Accept
          </button>
        </>
      )}
    </div>
  )
}

export const TopicFeedPage: Page = () => {
  const { topic } = useParams<{ topic: string }>()

  const topComponent = useMemo(() => {
    return (
      <div className="w-full">
        <div className="w-full h-16 text-center flex justify-center items-center border-b">
          <h1 className="text-lg text-gray-800">{topic}</h1>
        </div>
        {shittyTestIfYouTubeID.test(topic) && <TopFeedYoutubeEmbed id={topic} />}
      </div>
    )
  }, [topic])

  const [comments, advanceComments] = useTopicFeed(topic)

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

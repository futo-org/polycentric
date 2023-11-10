import { useEffect } from 'react'
import { Feed } from '../../../../components/feed/Feed'
import { useExploreFeed } from '../../../../hooks/feedHooks'

export const ExploreFeed = () => {
  const [data, advanceFeed] = useExploreFeed()
  useEffect(() => {
    advanceFeed()
  }, [advanceFeed])
  return <Feed data={data} advanceFeed={advanceFeed} />
}

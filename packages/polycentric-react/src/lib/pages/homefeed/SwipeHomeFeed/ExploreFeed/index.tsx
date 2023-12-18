import { Feed } from '../../../../components/feed/Feed'
import { useExploreFeed } from '../../../../hooks/feedHooks'

export const ExploreFeed = () => {
  const [data, advanceFeed] = useExploreFeed()

  return <Feed data={data} advanceFeed={advanceFeed} />
}

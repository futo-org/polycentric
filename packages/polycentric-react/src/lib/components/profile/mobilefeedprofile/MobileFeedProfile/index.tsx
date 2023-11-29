import { Models, Protocol } from '@polycentric/polycentric-core'
import { useAvatar } from '../../../../hooks/imageHooks'
import { useProcessHandleManager } from '../../../../hooks/processHandleManagerHooks'
import { useQueryIfAdded, useUsernameCRDTQuery } from '../../../../hooks/queryHooks'
import { PureMobileFeedProfile } from '../PureMobileFeedProfile'

export const MobileProfileFeed = ({ system }: { system: Models.PublicKey.PublicKey }) => {
  const name = useUsernameCRDTQuery(system)
  const avatarURL = useAvatar(system)
  const { processHandle } = useProcessHandleManager()

  const [localFollowing, setLocalFollowing] = useState<boolean | undefined>()
  const remotelyFollowing = useQueryIfAdded(
    Models.ContentType.ContentTypeFollow,
    processHandle.system(),
    Protocol.PublicKey.encode(system).finish(),
  )

  const follow = useCallback(() => {
    processHandle.follow(system).then(() => setLocalFollowing(true))
  }, [processHandle, system])

  const unfollow = useCallback(() => {
    processHandle.unfollow(system).then(() => setLocalFollowing(false))
  }, [processHandle, system])

  const isMyProfile = Models.PublicKey.equal(system, processHandle.system())

  const followers = 0
  const following = 0

  const iAmFollowing = localFollowing ? localFollowing : remotelyFollowing

  return (
    <PureMobileFeedProfile
      profile={{
        name,
        avatarURL,
        isMyProfile,
        iAmFollowing: iAmFollowing,
        followerCount: followers,
        followingCount: following,
      }}
      follow={follow}
      unfollow={unfollow}
    />
  )
}

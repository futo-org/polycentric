import { Synchronization } from '@polycentric/polycentric-core'
import { useCallback, useState } from 'react'
import { Compose } from '..'
import { useProcessHandleManager } from '../../../../hooks/processHandleManagerHooks'

export const PostCompose = () => {
  const { processHandle } = useProcessHandleManager()

  const [postingProgress, setPostingProgress] = useState(0)

  const onPost = useCallback(
    async (content: string, upload?: File): Promise<boolean> => {
      try {
        if (upload) {
          alert('uploading not yet supported, ask harpo to change ProcessHandle.post to support an image bundle')
        }
        setPostingProgress(0.1)
        await processHandle.post(content)
        setPostingProgress(0.5)
        await Synchronization.backFillServers(processHandle, processHandle.system())
        setPostingProgress(1)
        setTimeout(() => {
          setPostingProgress(0)
        }, 100)
      } catch (e) {
        console.error(e)
        setPostingProgress(0)
        return false
      }
      return true
    },
    [processHandle],
  )

  return (
    <div className="">
      <div className="py-3 lg:p-10">
        <Compose onPost={onPost} postingProgress={postingProgress} />
      </div>
      {postingProgress > 0 && (
        <div style={{ height: '4px', width: `${postingProgress * 100}%` }} className="bg-blue-500"></div>
      )}
    </div>
  )
}

import { CheckIcon, PencilIcon } from '@heroicons/react/24/outline'
import { CancelContext } from '@polycentric/polycentric-core'
import { useEffect, useState } from 'react'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import { useDebouncedEffect } from '../../../hooks/utilHooks'

const XIcon = ({ className }: { className: string }) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

const ServerListTableRow = ({
  originalServer,
  onServerChange,
  onServerDelete,
}: {
  originalServer: string
  onServerChange: (server: string) => void
  onServerDelete: () => void
}) => {
  const { processHandle } = useProcessHandleManager()
  const [currentSetServer, setCurrentSetServer] = useState<string>(originalServer)
  const [inputValue, setInputValue] = useState(originalServer)
  const [isEditing, setIsEditing] = useState(originalServer === '')
  const [isValidServer, setIsValidServer] = useState(false)

  useDebouncedEffect(
    () => {
      setIsValidServer(false)
      const cancelContext = new CancelContext.CancelContext()
      fetch(`${inputValue}/version`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelContext.cancelled() === false && json.sha && typeof json.sha === 'string') {
            setIsValidServer(true)
          }
        })
        .catch(() => {
          setIsValidServer(false)
        })

      return () => cancelContext.cancel()
    },
    [inputValue],
    1500,
  )

  const preEditPostButtons = (
    <>
      <button
        onClick={() => setIsEditing(true)}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
      >
        <PencilIcon className="h-5 w-5 text-gray-500" />
      </button>
      <button
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        onClick={() => {
          processHandle.removeServer(currentSetServer).then(() => {
            onServerDelete()
          })
        }}
      >
        <XIcon className="h-5 w-5 text-red-500" />
      </button>
    </>
  )

  const editPostButtons = (
    <>
      {/* Undo */}
      <button
        onClick={() => {
          if (currentSetServer === '') onServerDelete()
          setInputValue(currentSetServer)
          setIsEditing(false)
        }}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        aria-label="Undo"
      >
        <XIcon className="h-5 w-5" />
      </button>
      {/* Accept */}
      <button
        onClick={() => {
          currentSetServer !== '' && processHandle.removeServer(currentSetServer)
          processHandle.addServer(inputValue).then(() => {
            setCurrentSetServer(inputValue)
            onServerChange(inputValue)
            setIsEditing(false)
          })
        }}
        disabled={!isValidServer || inputValue === ''}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50 disabled:hover:bg-white disabled:text-gray-400"
        aria-label="Accept"
      >
        <CheckIcon className="h-5 w-5 disabled:bg-slate-500" />
      </button>
    </>
  )

  return (
    <tr>
      <td className="px-6 py-3 whitespace-nowrap">
        <div className="flex items-center justify-between space-x-2">
          {isEditing ? (
            <input
              className="text-sm font-medium text-gray-900 px-3 -ml-3 -mt-[1px] h-[2.25rem] border rounded-full flex-grow md:max-w-[20rem]"
              autoFocus={true}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            ></input>
          ) : (
            <div className="text-sm font-medium text-gray-900">{inputValue}</div>
          )}
          <div className="flex-shrink-0 flex space-x-2">{isEditing ? editPostButtons : preEditPostButtons}</div>
        </div>
      </td>
    </tr>
  )
}

export const ServerListTable = () => {
  const { processHandle } = useProcessHandleManager()

  const [servers, setServers] = useState<Array<string>>([])

  useEffect(() => {
    processHandle.loadSystemState(processHandle.system()).then((s) => {
      setServers(s.servers())
    })
  }, [processHandle])

  return (
    <div className="rounded-[2rem] border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className=" ">
          <tr className="">
            <th scope="col" className="pt-6 pl-6 pb-3 text-left text-sm font-medium">
              My Servers
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {servers.map((s, i) => (
            <ServerListTableRow
              key={s}
              originalServer={s}
              onServerDelete={() => {
                setServers((servers) => servers.filter((_, index) => index !== i))
              }}
              onServerChange={(server) => {
                setServers((servers) => {
                  const newServers = [...servers]
                  newServers[i] = server
                  return newServers
                })
              }}
            />
          ))}
        </tbody>
        <tfoot className="">
          <tr>
            <td
              colSpan={3}
              className="px-3 pb-3 pt-2 text-left text-xs font-medium uppercase tracking-wider flex justify-between"
            >
              <button
                disabled={servers.filter((s) => s === '').length >= 1}
                className="btn btn-primary rounded-full h-[2.25rem] px-3 border bg-white hover:bg-gray-50 text-gray-700 disabled:hover:bg-white disabled:text-gray-500"
                onClick={() => setServers((s) => [...s, ''])}
              >
                Add Server
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

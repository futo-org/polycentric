import { CheckIcon, PencilIcon } from '@heroicons/react/24/outline';
import { CancelContext } from '@polycentric/polycentric-core';
import { useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useQueryServers } from '../../../hooks/queryHooks';
import { useDebouncedEffect } from '../../../hooks/utilHooks';

const XIcon = ({ className }: { className: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
};

interface ExistingServer {
  kind: 'existingServer';
  server: string;
}

interface NewServer {
  kind: 'newServer';
  close: () => void;
}

const ServerListTableRow = ({
  params,
}: {
  params: ExistingServer | NewServer;
}) => {
  const { processHandle } = useProcessHandleManager();

  const [inputValue, setInputValue] = useState(
    params.kind === 'existingServer' ? params.server : '',
  );

  const [isEditing, setIsEditing] = useState(params.kind === 'newServer');

  const [isValidServer, setIsValidServer] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [mutationSubmitted, setMutationSubmitted] = useState(false);

  useDebouncedEffect(
    () => {
      if (!inputValue) {
        setIsValidServer(false);
        setIsValidating(false);
        return;
      }

      setIsValidating(true);
      setIsValidServer(false);

      const cancelContext = new CancelContext.CancelContext();

      let urlToCheck = inputValue;
      if (
        !urlToCheck.startsWith('http://') &&
        !urlToCheck.startsWith('https://')
      ) {
        urlToCheck = 'https://' + urlToCheck;
      }

      fetch(`${urlToCheck}/version`)
        .then((res) => res.json())
        .then((json) => {
          if (
            cancelContext.cancelled() === false &&
            json.sha &&
            typeof json.sha === 'string'
          ) {
            setIsValidServer(true);
          }
        })
        .catch(() => {
          setIsValidServer(false);
        })
        .finally(() => {
          if (!cancelContext.cancelled()) {
            setIsValidating(false);
          }
        });

      return () => cancelContext.cancel();
    },
    [inputValue],
    500,
  );

  const preEditPostButtons = (
    <>
      <button
        onClick={() => setIsEditing(true)}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        disabled={mutationSubmitted}
      >
        <PencilIcon className="h-5 w-5 text-gray-500" />
      </button>
      <button
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        onClick={() => {
          if (params.kind === 'existingServer') {
            setMutationSubmitted(true);
            processHandle.removeServer(params.server);
          }
        }}
        disabled={mutationSubmitted}
      >
        <XIcon className="h-5 w-5 text-red-500" />
      </button>
    </>
  );

  const handleServerSubmit = () => {
    setMutationSubmitted(true);

    const serverUrl = inputValue;

    // Close first to prevent duplication issues
    if (params.kind === 'newServer') {
      params.close();
    }

    // Remove server if we're editing an existing one
    if (params.kind === 'existingServer') {
      processHandle.removeServer(params.server);
    }

    // Add the server
    processHandle.addServer(serverUrl);
  };

  const editPostButtons = (
    <>
      {/* Undo */}
      <button
        onClick={() => {
          if (params.kind === 'existingServer') {
            setInputValue(params.server);
            setIsEditing(false);
          } else {
            params.close();
          }
        }}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        aria-label="Undo"
        disabled={mutationSubmitted}
      >
        <XIcon className="h-5 w-5" />
      </button>
      {/* Accept */}
      <button
        onClick={handleServerSubmit}
        disabled={
          (!isValidServer && !isValidating) ||
          inputValue === '' ||
          mutationSubmitted
        }
        className={`btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border ${
          isValidating ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
        } disabled:hover:bg-white disabled:text-gray-400`}
        aria-label="Accept"
      >
        {isValidating ? (
          <div className="h-4 w-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        ) : (
          <CheckIcon className="h-5 w-5 disabled:bg-slate-500" />
        )}
      </button>
    </>
  );

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
            <div className="text-sm font-medium text-gray-900">
              {inputValue}
            </div>
          )}
          <div className="flex-shrink-0 flex space-x-2">
            {isEditing ? editPostButtons : preEditPostButtons}
          </div>
        </div>
      </td>
    </tr>
  );
};

const FEATURED_SERVERS = ['https://serv2.polycentric.io'];

export const ServerListTable = () => {
  const { processHandle } = useProcessHandleManager();
  const [newServer, setNewServer] = useState(false);
  const servers = useQueryServers(processHandle.system());

  return (
    <div className="rounded-[2rem] border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th
              scope="col"
              className="pt-6 pl-6 pb-3 text-left text-sm font-medium"
            >
              My Servers
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {[...servers].map((s) => (
            <ServerListTableRow
              key={s}
              params={{
                kind: 'existingServer',
                server: s,
              }}
            />
          ))}
          {newServer && (
            <ServerListTableRow
              params={{
                kind: 'newServer',
                close: () => setNewServer(false),
              }}
            />
          )}
        </tbody>
        <thead>
          <tr>
            <th
              scope="col"
              className="pt-6 pl-6 pb-3 text-left text-sm font-medium"
            >
              Featured Servers
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {FEATURED_SERVERS.filter((server) => !servers.has(server)).map(
            (server) => (
              <tr key={server}>
                <td className="px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-between space-x-2">
                    <div className="text-sm font-medium text-gray-900">
                      {server}
                    </div>
                    <button
                      onClick={() => processHandle.addServer(server)}
                      className="btn btn-primary rounded-full h-[2.25rem] px-3 border bg-white hover:bg-gray-50 text-gray-700"
                    >
                      Add Server
                    </button>
                  </div>
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={3}
              className="px-3 pb-3 pt-2 text-left text-xs font-medium uppercase tracking-wider flex justify-between"
            >
              <button
                disabled={newServer}
                className="btn btn-primary rounded-full h-[2.25rem] px-3 border bg-white hover:bg-gray-50 text-gray-700 disabled:hover:bg-white disabled:text-gray-500"
                onClick={() => setNewServer(true)}
              >
                Add Server
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

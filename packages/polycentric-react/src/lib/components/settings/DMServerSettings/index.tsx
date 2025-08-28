import { CheckIcon, PencilIcon } from '@heroicons/react/24/outline';
import { CancelContext } from '@polycentric/polycentric-core';
import { useEffect, useState } from 'react';
import { getDMServerUrl, setDMServerUrl } from '../../../dm/dmServerConfig';
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

export const DMServerSettings = () => {
  const [dmServer, setDmServer] = useState(() => {
    return getDMServerUrl();
  });
  
  const [inputValue, setInputValue] = useState(dmServer);
  const [isEditing, setIsEditing] = useState(false);
  const [isValidServer, setIsValidServer] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  // Save to localStorage whenever dmServer changes
  useEffect(() => {
    setDMServerUrl(dmServer);
  }, [dmServer]);

  useDebouncedEffect(
    () => {
      if (!inputValue) {
        setIsValidServer(false);
        setIsValidating(false);
        return;
      }

      // Allow localhost without version check
      const isLocalhost = /^(https?:\/\/)?localhost(:\d+)?$/.test(inputValue);
      if (isLocalhost) {
        setIsValidServer(true);
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

      // Check for DM server health endpoint
      fetch(`${urlToCheck}/health`)
        .then((res) => {
          if (cancelContext.cancelled() === false && res.ok) {
            setIsValidServer(true);
          } else {
            setIsValidServer(false);
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

  const handleSave = () => {
    setDmServer(inputValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setInputValue(dmServer);
    setIsEditing(false);
  };

  const preEditButtons = (
    <button
      onClick={() => setIsEditing(true)}
      className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
    >
      <PencilIcon className="h-5 w-5 text-gray-500" />
    </button>
  );

  const editButtons = (
    <>
      <button
        onClick={handleCancel}
        className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50"
        aria-label="Cancel"
      >
        <XIcon className="h-5 w-5" />
      </button>
      <button
        onClick={handleSave}
        disabled={(!isValidServer && !isValidating) || inputValue === ''}
        className={`btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border ${
          isValidating ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
        } disabled:hover:bg-white disabled:text-gray-400`}
        aria-label="Save"
      >
        {isValidating ? (
          <div className="h-4 w-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        ) : (
          <CheckIcon className="h-5 w-5" />
        )}
      </button>
    </>
  );

  return (
    <div className="rounded-[2rem] border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th
              scope="col"
              className="pt-6 pl-6 pb-3 text-left text-sm font-medium"
            >
              DM Server
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          <tr>
            <td className="px-6 py-3 whitespace-nowrap">
              <div className="flex items-center justify-between space-x-2">
                {isEditing ? (
                  <input
                    className="text-sm font-medium text-gray-900 px-3 -ml-3 -mt-[1px] h-[2.25rem] border rounded-full flex-grow md:max-w-[20rem]"
                    autoFocus={true}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="https://your-dm-server.com"
                  />
                ) : (
                  <div className="text-sm font-medium text-gray-900">
                    {dmServer}
                  </div>
                )}
                <div className="flex-shrink-0 flex space-x-2">
                  {isEditing ? editButtons : preEditButtons}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

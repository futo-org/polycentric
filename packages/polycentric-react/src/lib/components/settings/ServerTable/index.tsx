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
    const [mutationSubmitted, setMutationSubmitted] = useState(false);

    useDebouncedEffect(
        () => {
            setIsValidServer(false);
            const cancelContext = new CancelContext.CancelContext();
            fetch(`${inputValue}/version`)
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
                });

            return () => cancelContext.cancel();
        },
        [inputValue],
        1000,
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
                onClick={() => {
                    setMutationSubmitted(true);
                    if (params.kind === 'existingServer') {
                        processHandle.removeServer(params.server);
                    }
                    processHandle.addServer(inputValue);
                    if (params.kind === 'newServer') {
                        params.close();
                    }
                }}
                disabled={
                    !isValidServer || inputValue === '' || mutationSubmitted
                }
                className="btn btn-primary rounded-full h-[2.25rem] w-[2.25rem] flex justify-center items-center border bg-white hover:bg-gray-50 disabled:hover:bg-white disabled:text-gray-400"
                aria-label="Accept"
            >
                <CheckIcon className="h-5 w-5 disabled:bg-slate-500" />
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

const FEATURED_SERVERS = [
    'https://srv1-prod.polycentric.io',
    'https://prod-posts1.polycentric.io',
];

export const ServerListTable = () => {
    const { processHandle } = useProcessHandleManager();
    const [newServer, setNewServer] = useState(false);
    const servers = useQueryServers(processHandle.system());

    return (
        <div className="rounded-[2rem] border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
                <thead>
                    <tr>
                        <th scope="col" className="pt-6 pl-6 pb-3 text-left text-sm font-medium">
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
                        <th scope="col" className="pt-6 pl-6 pb-3 text-left text-sm font-medium">
                            Featured Servers
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {FEATURED_SERVERS.filter(server => !servers.has(server)).map((server) => (
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
                    ))}
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

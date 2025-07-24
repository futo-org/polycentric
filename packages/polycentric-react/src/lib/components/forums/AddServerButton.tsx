import React from 'react';
import { useForumServers } from '../../hooks/forumServerHooks';

interface AddServerButtonProps {
  serverUrl: string | null | undefined;
  className?: string;
}

/**
 * Toggle button that lets the user add *or* remove the current forum server
 * from their personal list.  Always visible as long as `serverUrl` is
 * provided.
 */
export const AddServerButton: React.FC<AddServerButtonProps> = ({
  serverUrl,
  className,
}) => {
  const { servers, addServer, removeServer } = useForumServers();

  if (!serverUrl) return null;

  const isInList = servers.has(serverUrl);

  const handleClick = () => {
    if (isInList) {
      removeServer(serverUrl);
    } else {
      addServer(serverUrl);
    }
  };

  const defaultStyleBase = 'px-3 py-1 rounded-md text-sm focus:outline-none';

  const defaultStyle = isInList
    ? `${defaultStyleBase} bg-red-500 text-white hover:bg-red-600`
    : `${defaultStyleBase} bg-blue-500 text-white hover:bg-blue-600`;

  return (
    <button onClick={handleClick} className={className || defaultStyle}>
      {isInList ? 'Remove Server' : 'Add Server'}
    </button>
  );
};

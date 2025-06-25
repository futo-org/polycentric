import { useEffect } from 'react';
import { useForumServers } from './forumServerHooks';

// Keep a module-level set so we only bother the user **once per app session**
// for each individual server.  The set is reset on page reload.
const promptedServers = new Set<string>();

/**
 * Prompts the user to add the visited forum `serverUrl` to their personal list.
 * – Only runs if the server is **not** already in the list.
 * – Each server is prompted **at most once per browser session** (until page reload).
 */
export const useAddServerPrompt = (serverUrl: string | null | undefined) => {
  const { servers, addServer } = useForumServers();

  useEffect(() => {
    if (!serverUrl) return;

    // Already saved – nothing to do
    if (servers.has(serverUrl)) return;

    // Already prompted during this session
    if (promptedServers.has(serverUrl)) return;

    promptedServers.add(serverUrl);

    const shouldAdd = window.confirm(
      `You are viewing a forum hosted at ${serverUrl}. Would you like to add this server to your forum list?`,
    );

    if (shouldAdd) {
      addServer(serverUrl);
    }
  }, [serverUrl, servers, addServer]);
};

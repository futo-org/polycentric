import { useEffect, useState } from 'react';

const FORUM_SERVERS_STORAGE_KEY = 'polycentric_forum_servers';

// Helper function to get servers from Local Storage
const getStoredForumServers = (): Set<string> => {
  try {
    const stored = localStorage.getItem(FORUM_SERVERS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure it's an array before creating a Set
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch (error) {
    console.error('Error reading forum servers from local storage:', error);
  }
  return new Set();
};

// Helper function to save servers to Local Storage
const storeForumServers = (servers: Set<string>): void => {
  try {
    const serversArray = Array.from(servers);
    localStorage.setItem(
      FORUM_SERVERS_STORAGE_KEY,
      JSON.stringify(serversArray),
    );
  } catch (error) {
    console.error('Error saving forum servers to local storage:', error);
  }
};

export const useForumServers = () => {
  const [servers, setServers] = useState<Set<string>>(new Set());

  // Load servers from local storage on initial mount
  useEffect(() => {
    setServers(getStoredForumServers());
  }, []);

  const addServer = (serverUrl: string) => {
    let urlToAdd = serverUrl.trim();
    if (urlToAdd.endsWith('/')) {
      urlToAdd = urlToAdd.slice(0, -1);
    }
    if (
      !urlToAdd.startsWith('http://') &&
      !urlToAdd.startsWith('https://') &&
      !urlToAdd.startsWith('localhost')
    ) {
      urlToAdd = 'https://' + urlToAdd;
    }

    const newServers = new Set(servers);
    newServers.add(urlToAdd);

    setServers(newServers);
    storeForumServers(newServers);
  };

  const removeServer = (serverUrl: string) => {
    const newServers = new Set(servers);
    newServers.delete(serverUrl);

    setServers(newServers);
    storeForumServers(newServers);
  };

  return { servers, addServer, removeServer };
};

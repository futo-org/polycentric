import { useEffect, useMemo, useState } from 'react';

interface ServerInfo {
  name: string;
  imageUrl?: string | null; // Optional image URL
}

interface UseServerInfoResult {
  serverInfo: ServerInfo | null;
  loading: boolean;
  error: string | null;
}

// Cache for server info to avoid redundant fetches
const serverInfoCache = new Map<string, ServerInfo>();

export function useServerInfo(
  serverUrl: string | null | undefined,
): UseServerInfoResult {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Use base URL without trailing slash for cache key and API call
  const baseUrl = useMemo(() => {
    if (!serverUrl) return null;
    try {
      const url = new URL(serverUrl);
      return `${url.protocol}//${url.host}`; // Get protocol and host
    } catch (e) {
      console.error('Invalid server URL for useServerInfo:', serverUrl, e);
      return null;
    }
  }, [serverUrl]);

  useEffect(() => {
    if (!baseUrl) {
      setServerInfo(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Check cache first
    if (serverInfoCache.has(baseUrl)) {
      setServerInfo(serverInfoCache.get(baseUrl)!);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchServerInfo = async () => {
      setLoading(true);
      setError(null);
      // Construct the API URL correctly (no /forum prefix)
      const apiUrl = `${baseUrl}/server-info`;

      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          // Handle non-2xx responses gracefully
          if (response.status === 404) {
            // Treat 404 as server not having info, use URL as name
            const fallbackInfo: ServerInfo = { name: baseUrl };
            serverInfoCache.set(baseUrl, fallbackInfo);
            setServerInfo(fallbackInfo);
            console.warn(
              `Server info endpoint not found at ${apiUrl}. Using URL as name.`,
            );
          } else {
            throw new Error(
              `Failed to fetch server info: ${response.status} ${response.statusText}`,
            );
          }
        } else {
          const data: ServerInfo = await response.json();
          // Basic validation
          if (!data || typeof data.name !== 'string') {
            throw new Error('Invalid server info format received');
          }
          serverInfoCache.set(baseUrl, data); // Cache successful result
          setServerInfo(data);
        }
      } catch (fetchError: any) {
        console.error(`Error fetching server info from ${apiUrl}:`, fetchError);
        setError(fetchError.message || 'Failed to load server info.');
        // Fallback to using the URL as name on error
        const fallbackInfo: ServerInfo = { name: baseUrl };
        // Optionally cache the fallback on error? Debatable.
        // serverInfoCache.set(baseUrl, fallbackInfo);
        setServerInfo(fallbackInfo);
      } finally {
        setLoading(false);
      }
    };

    fetchServerInfo();
  }, [baseUrl]); // Dependency is the processed baseUrl

  return { serverInfo, loading, error };
}

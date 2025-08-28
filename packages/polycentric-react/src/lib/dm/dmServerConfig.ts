import { DMServerConfig } from './DMClient';

const DM_SERVER_KEY = 'polycentric-dm-server';
const DEFAULT_DM_SERVER = 'http://dm_server:8080';

/**
 * Get the DM server configuration from localStorage
 */
export function getDMServerConfig(): DMServerConfig {
  const serverUrl = localStorage.getItem(DM_SERVER_KEY) || DEFAULT_DM_SERVER;

  // Ensure URL has proper protocol
  let httpUrl = serverUrl;
  if (!httpUrl.startsWith('http://') && !httpUrl.startsWith('https://')) {
    httpUrl = `https://${httpUrl}`;
  }

  // Remove trailing slash
  if (httpUrl.endsWith('/')) {
    httpUrl = httpUrl.slice(0, -1);
  }

  // Convert HTTP URL to WebSocket URL
  const websocketUrl = httpUrl.replace(
    /^https?:/,
    httpUrl.startsWith('https:') ? 'wss:' : 'ws:',
  );

  return {
    httpUrl,
    websocketUrl,
  };
}

/**
 * Set the DM server URL in localStorage
 */
export function setDMServerUrl(url: string): void {
  localStorage.setItem(DM_SERVER_KEY, url);
}

/**
 * Get the raw DM server URL from localStorage
 */
export function getDMServerUrl(): string {
  return localStorage.getItem(DM_SERVER_KEY) || DEFAULT_DM_SERVER;
}

/**
 * Clear the DM server URL from localStorage (forces use of default)
 */
export function clearDMServerUrl(): void {
  localStorage.removeItem(DM_SERVER_KEY);
}

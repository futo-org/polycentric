import * as Core from '@polycentric/polycentric-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProcessHandleManager } from '../hooks/processHandleManagerHooks';
import { DecryptedMessage, DMClient, DMMessageContent, DMServerConfig, EncryptedMessage } from './DMClient';

export interface UseDMClientOptions {
  config: DMServerConfig;
  autoConnect?: boolean;
}

export interface UseDMClientReturn {
  client: DMClient | null;
  isConnected: boolean;
  isRegistered: boolean;
  messages: DecryptedMessage[];
  error: string | null;
  
  // Actions
  registerKeys: () => Promise<void>;
  sendMessage: (recipient: Core.Models.PublicKey.PublicKey, content: DMMessageContent, replyTo?: string) => Promise<string>;
  loadHistory: (otherParty: Core.Models.PublicKey.PublicKey, cursor?: string) => Promise<void>;
  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => void;
  clearError: () => void;
}

/**
 * React hook for managing DM client functionality
 */
export function useDMClient(options: UseDMClientOptions): UseDMClientReturn {
  const { processHandle } = useProcessHandleManager();
  const [client, setClient] = useState<DMClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<DecryptedMessage[]>([]);

  // Initialize client when process handle is available
  useEffect(() => {
    if (processHandle) {
      const dmClient = new DMClient(options.config, processHandle);
      
      // Set up message handler
      dmClient.onMessage((encryptedMsg: EncryptedMessage) => {
        handleIncomingMessage(encryptedMsg, dmClient);
      });
      
      // Set up connection handler
      dmClient.onConnectionChange(setIsConnected);
      
      setClient(dmClient);
      
      if (options.autoConnect) {
        // Auto-register keys and connect
        registerKeysAndConnect(dmClient);
      }
    }
  }, [processHandle, options.config, options.autoConnect]);

  const handleIncomingMessage = useCallback(async (encryptedMsg: EncryptedMessage, dmClient: DMClient) => {
    try {
      // Decrypt the message
      const decrypted = await decryptMessage(encryptedMsg, dmClient);
      
      // Add to messages list
      setMessages(prev => {
        const newMessages = [...prev, decrypted].sort((a, b) => 
          a.timestamp.getTime() - b.timestamp.getTime()
        );
        messagesRef.current = newMessages;
        return newMessages;
      });
    } catch (err) {
      console.error('Failed to decrypt incoming message:', err);
      setError('Failed to decrypt incoming message');
    }
  }, []);

  const decryptMessage = async (encryptedMsg: EncryptedMessage, dmClient: DMClient): Promise<DecryptedMessage> => {
    // This would use the DMClient's decryption method
    // For now, we'll assume the client handles this internally
    return {
      messageId: encryptedMsg.messageId,
      sender: encryptedMsg.sender,
      content: { type: 'text', text: 'Encrypted message' }, // Placeholder
      timestamp: encryptedMsg.timestamp,
      replyTo: encryptedMsg.replyTo,
    };
  };

  const registerKeysAndConnect = async (dmClient: DMClient) => {
    try {
      await dmClient.generateAndRegisterKeys();
      setIsRegistered(true);
      
      if (options.autoConnect) {
        await dmClient.connectWebSocket();
      }
    } catch (err) {
      console.error('Failed to register keys or connect:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize DM client');
    }
  };

  const registerKeys = useCallback(async () => {
    if (!client) {
      setError('Client not initialized');
      return;
    }

    try {
      setError(null);
      await client.generateAndRegisterKeys();
      setIsRegistered(true);
    } catch (err) {
      console.error('Failed to register keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to register keys');
    }
  }, [client]);

  const sendMessage = useCallback(async (
    recipient: Core.Models.PublicKey.PublicKey,
    content: DMMessageContent,
    replyTo?: string
  ): Promise<string> => {
    if (!client) {
      throw new Error('Client not initialized');
    }

    try {
      setError(null);
      const messageId = await client.sendMessage(recipient, content, replyTo);
      
      // Add to local messages immediately for optimistic UI
      const newMessage: DecryptedMessage = {
        messageId,
        sender: processHandle!.system(),
        content,
        timestamp: new Date(),
        replyTo,
      };
      
      setMessages(prev => {
        const newMessages = [...prev, newMessage].sort((a, b) => 
          a.timestamp.getTime() - b.timestamp.getTime()
        );
        messagesRef.current = newMessages;
        return newMessages;
      });
      
      return messageId;
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err;
    }
  }, [client, processHandle]);

  const loadHistory = useCallback(async (
    otherParty: Core.Models.PublicKey.PublicKey,
    cursor?: string
  ) => {
    if (!client) {
      setError('Client not initialized');
      return;
    }

    try {
      setError(null);
      const history = await client.getHistory(otherParty, cursor);
      
      if (cursor) {
        // Append to existing messages
        setMessages(prev => {
          const combined = [...prev, ...history.messages];
          const unique = combined.filter((msg, index, arr) => 
            arr.findIndex(m => m.messageId === msg.messageId) === index
          );
          const sorted = unique.sort((a, b) => 
            a.timestamp.getTime() - b.timestamp.getTime()
          );
          messagesRef.current = sorted;
          return sorted;
        });
      } else {
        // Replace messages
        setMessages(history.messages);
        messagesRef.current = history.messages;
      }
    } catch (err) {
      console.error('Failed to load history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load message history');
    }
  }, [client]);

  const connectWebSocket = useCallback(async () => {
    if (!client) {
      setError('Client not initialized');
      return;
    }

    try {
      setError(null);
      await client.connectWebSocket();
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to real-time messaging');
    }
  }, [client]);

  const disconnectWebSocket = useCallback(() => {
    if (client) {
      // Assuming the client has a disconnect method
      setIsConnected(false);
    }
  }, [client]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    client,
    isConnected,
    isRegistered,
    messages,
    error,
    registerKeys,
    sendMessage,
    loadHistory,
    connectWebSocket,
    disconnectWebSocket,
    clearError,
  };
}

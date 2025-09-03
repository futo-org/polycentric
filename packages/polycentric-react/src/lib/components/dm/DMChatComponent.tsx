import * as Core from '@polycentric/polycentric-core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDMServerConfig } from '../../dm/dmServerConfig';
import { useDMClient } from '../../dm/useDMClient';
import { useAvatar } from '../../hooks/imageHooks';
import { useSystemLink, useTextPublicKey, useUsernameCRDTQuery } from '../../hooks/queryHooks';
import { DMMessageContent, DecryptedMessage } from '../../types/dm';
import { ProfilePicture } from '../profile/ProfilePicture';
import { Link } from '../util/link';

export interface DMChatComponentProps {
  otherParty?: Core.Models.PublicKey.PublicKey;
  otherPartyName?: string;
  className?: string;
}

// Component to display user information with username and avatar
const UserDisplay: React.FC<{ publicKey: Core.Models.PublicKey.PublicKey }> = ({ publicKey }) => {
  const username = useUsernameCRDTQuery(publicKey) || 'User';
  const shortPublicKey = useTextPublicKey(publicKey, 10);
  const avatarUrl = useAvatar(publicKey);
  const userLink = useSystemLink(publicKey);

  return (
    <div className="flex items-center space-x-3">
      <ProfilePicture
        src={avatarUrl}
        alt={`${username}'s profile picture`}
        className="w-8 h-8 rounded-full"
      />
      <div className="flex items-center space-x-2">
        {userLink ? (
          <Link
            routerLink={userLink}
            className="font-medium text-gray-900 hover:underline"
          >
            {username}
          </Link>
        ) : (
          <span className="font-medium text-gray-900">{username}</span>
        )}
        {shortPublicKey && (
          <span className="text-xs text-gray-500 font-mono">
            {shortPublicKey}
          </span>
        )}
      </div>
    </div>
  );
};

// Component for individual messages to avoid hooks in map
const MessageItem: React.FC<{ 
  message: DecryptedMessage; 
  otherParty?: Core.Models.PublicKey.PublicKey;
}> = ({ message, otherParty }) => {
  const username = useUsernameCRDTQuery(message.sender) || 'User';
  const avatarUrl = useAvatar(message.sender);
  const isReceived = message.sender.key.toString() === otherParty?.key.toString();
  
  return (
    <div
      key={message.messageId}
      className={`message ${isReceived ? 'received' : 'sent'}`}
    >
      <div className="message-header">
        <div className="flex items-center space-x-2 mb-1">
          <ProfilePicture
            src={avatarUrl}
            alt={`${username}'s profile picture`}
            className="w-6 h-6 rounded-full"
          />
          <span className="text-xs text-gray-600 font-medium">
            {username}
          </span>
        </div>
      </div>
      <div className="message-content">
        {message.content.type === 'text' && message.content.text && (
          <p>{message.content.text}</p>
        )}
        {message.content.type === 'file' && (
          <div className="file-message">
            <span>📎 {message.content.file?.filename}</span>
          </div>
        )}
      </div>
      <div className="message-timestamp">
        {message.timestamp.toLocaleTimeString()}
      </div>
    </div>
  );
};

export const DMChatComponent: React.FC<DMChatComponentProps> = ({
  otherParty,
  otherPartyName,
  className = '',
}) => {
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Memoize the config to prevent infinite re-renders
  const dmConfig = useMemo(() => getDMServerConfig(), []);

  const {
    client,
    isConnected,
    isRegistered,
    messages,
    error,
    registerKeys,
    sendMessage,
    loadHistory,
    connectWebSocket,
    clearError,
  } = useDMClient({
    config: dmConfig,
    autoConnect: true,
  });

  // Load message history when component mounts
  useEffect(() => {
    if (isRegistered && otherParty) {
      loadHistory(otherParty);
    }
  }, [isRegistered, otherParty, loadHistory]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageText.trim() || !client || isLoading || !otherParty) {
      return;
    }

    const content: DMMessageContent = {
      type: 'text',
      text: messageText.trim(),
    };

    setIsLoading(true);
    try {
      await sendMessage(otherParty, content);
      setMessageText('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryRegistration = async () => {
    try {
      await registerKeys();
      await connectWebSocket();
    } catch (err) {
      console.error('Failed to retry registration:', err);
    }
  };

  if (error) {
    return (
      <div className={`dm-chat-error ${className}`}>
        <div className="error-message">
          <h3>Connection Error</h3>
          <p>{error}</p>
          <button onClick={clearError} className="retry-button">
            Dismiss
          </button>
          {!isRegistered && (
            <button onClick={handleRetryRegistration} className="retry-button">
              Retry Setup
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!isRegistered) {
    return (
      <div className={`dm-chat-setup ${className}`}>
        <div className="setup-message">
          <h3>Setting up secure messaging...</h3>
          <p>Generating encryption keys for secure direct messages.</p>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className={`dm-chat ${className}`}>
      <div className="dm-chat-header">
        <div className="flex items-center justify-between">
          {otherParty && <UserDisplay publicKey={otherParty} />}
          <div className="flex items-center space-x-2">
            {isConnected && <span className="status-indicator online">●</span>}
            {!isConnected && <span className="status-indicator offline">○</span>}
          </div>
        </div>
      </div>

      <div className="dm-chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>No messages yet. Start the conversation!</p>
          </div>
        )}

        {messages.map((message) => (
          <MessageItem key={message.messageId} message={message} otherParty={otherParty} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {otherParty && (
        <form onSubmit={handleSendMessage} className="dm-chat-input">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a message..."
            disabled={isLoading || !isConnected}
            className="message-input"
          />
          <button
            type="submit"
            disabled={!messageText.trim() || isLoading || !isConnected}
            className="send-button"
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </form>
      )}

      <style>{`
        .dm-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          max-height: 600px;
          border: 1px solid #e1e5e9;
          border-radius: 8px;
          background: white;
        }

        .dm-chat-header {
          padding: 1rem;
          border-bottom: 1px solid #e1e5e9;
          background: #f8f9fa;
        }

        .dm-chat-header h3 {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .status-indicator {
          font-size: 0.8rem;
        }

        .status-indicator.online {
          color: #28a745;
        }

        .status-indicator.offline {
          color: #6c757d;
        }

        .dm-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .empty-state {
          text-align: center;
          color: #6c757d;
          margin-top: 2rem;
        }

        .message {
          max-width: 70%;
          word-wrap: break-word;
        }

        .message.sent {
          align-self: flex-end;
        }

        .message.sent .message-content {
          background: #007bff;
          color: white;
        }

        .message.received {
          align-self: flex-start;
        }

        .message.received .message-content {
          background: #e9ecef;
          color: #333;
        }

        .message-content {
          padding: 0.5rem 0.75rem;
          border-radius: 1rem;
          margin-bottom: 0.25rem;
        }

        .message-content p {
          margin: 0;
        }

        .file-message {
          font-style: italic;
        }

        .message-timestamp {
          font-size: 0.75rem;
          color: #6c757d;
          text-align: right;
        }

        .message.received .message-timestamp {
          text-align: left;
        }

        .dm-chat-input {
          display: flex;
          padding: 1rem;
          border-top: 1px solid #e1e5e9;
          gap: 0.5rem;
        }

        .message-input {
          flex: 1;
          padding: 0.5rem;
          border: 1px solid #ced4da;
          border-radius: 0.25rem;
          outline: none;
        }

        .message-input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
        }

        .send-button {
          padding: 0.5rem 1rem;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
        }

        .send-button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .send-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .dm-chat-error,
        .dm-chat-setup {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          text-align: center;
        }

        .error-message {
          color: #dc3545;
        }

        .setup-message {
          color: #6c757d;
        }

        .retry-button {
          margin: 0.5rem;
          padding: 0.5rem 1rem;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 1rem auto;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

import * as Core from '@polycentric/polycentric-core';
import React from 'react';
import { useAvatar } from '../../hooks/imageHooks';
import { useSystemLink, useTextPublicKey, useUsernameCRDTQuery } from '../../hooks/queryHooks';
import { Conversation } from '../../types/dm';
import { ProfilePicture } from '../profile/ProfilePicture';
import { Link } from '../util/link';



export interface ConversationListProps {
  conversations: Conversation[];
  onSelectConversation: (otherParty: Core.Models.PublicKey.PublicKey) => void;
  onStartNewConversation: () => void;
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
        className="w-10 h-10 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          {userLink ? (
            <Link
              routerLink={userLink}
              className="font-medium text-gray-900 hover:underline truncate"
            >
              {username}
            </Link>
          ) : (
            <span className="font-medium text-gray-900 truncate">{username}</span>
          )}
          {shortPublicKey && (
            <span className="text-xs text-gray-500 font-mono flex-shrink-0">
              {shortPublicKey}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  onSelectConversation,
  onStartNewConversation,
  className = '',
}) => {
  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m ago`;
    } else {
      return 'Just now';
    }
  };



  return (
    <div className={`conversation-list ${className}`}>
      <div className="conversation-list-header">
        <h2 className="text-xl font-semibold text-gray-900">Conversations</h2>
        <button
          onClick={onStartNewConversation}
          className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
        >
          New Message
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <div className="text-center py-8">
            <div className="text-gray-400 text-6xl mb-4">💬</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No conversations yet
            </h3>
            <p className="text-gray-600 mb-4">
              Start a conversation to begin messaging
            </p>
            <button
              onClick={onStartNewConversation}
              className="bg-blue-500 text-white px-6 py-2 rounded-md hover:bg-blue-600 transition-colors"
            >
              Start Your First Conversation
            </button>
          </div>
        </div>
      ) : (
        <div className="conversation-items">
          {conversations.map((conversation) => (
            <div
              key={conversation.otherParty.key.toString()}
              onClick={() => onSelectConversation(conversation.otherParty)}
              className="conversation-item hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <UserDisplay publicKey={conversation.otherParty} />
              
              <div className="conversation-content flex-1 min-w-0">
                <div className="conversation-header flex justify-between items-start mb-1">
                  {conversation.lastMessage && (
                    <span className="conversation-time text-sm text-gray-500 flex-shrink-0">
                      {formatTimestamp(conversation.lastMessage.timestamp)}
                    </span>
                  )}
                </div>

                {conversation.lastMessage ? (
                  <div className="conversation-preview">
                    <p className="text-sm text-gray-600">
                      📄 Message
                    </p>
                  </div>
                ) : (
                  <div className="conversation-preview">
                    <p className="text-sm text-gray-400 italic">
                      No messages yet
                    </p>
                  </div>
                )}
              </div>

              {conversation.unreadCount > 0 && (
                <div className="unread-badge">
                  <span className="bg-blue-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                    {conversation.unreadCount > 99
                      ? '99+'
                      : conversation.unreadCount}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .conversation-list {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: white;
          border-radius: 8px;
          border: 1px solid #e1e5e9;
        }

        .conversation-list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          border-bottom: 1px solid #e1e5e9;
          background: #f8f9fa;
        }

        .conversation-list-header h2 {
          margin: 0;
        }

        .empty-state {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .conversation-items {
          flex: 1;
          overflow-y: auto;
        }

        .conversation-item {
          display: flex;
          align-items: center;
          padding: 1rem;
          border-bottom: 1px solid #f1f3f4;
          gap: 0.75rem;
        }

        .conversation-item:last-child {
          border-bottom: none;
        }

        .conversation-avatar {
          flex-shrink: 0;
        }

        .conversation-content {
          flex: 1;
          min-width: 0;
        }

        .conversation-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .conversation-name {
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .conversation-time {
          flex-shrink: 0;
        }

        .conversation-preview {
          margin: 0;
        }

        .conversation-preview p {
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .unread-badge {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
};

import * as Core from '@polycentric/polycentric-core';

export interface DMMessageContent {
  type: 'text' | 'image' | 'file' | 'typing' | 'read_receipt';
  text?: string;
  file?: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    fileId: string;
  };
  typing?: {
    isTyping: boolean;
  };
  readReceipt?: {
    messageId: string;
    readTimestamp: Date;
  };
}

export interface EncryptedMessage {
  messageId: string;
  sender: Core.Models.PublicKey.PublicKey;
  recipient: Core.Models.PublicKey.PublicKey;
  ephemeralPublicKey: Uint8Array;
  encryptedContent: Uint8Array;
  nonce: Uint8Array;
  encryptionAlgorithm: string;
  timestamp: Date;
  replyTo?: string;
}

export interface DecryptedMessage {
  messageId: string;
  sender: Core.Models.PublicKey.PublicKey;
  content: DMMessageContent;
  timestamp: Date;
  replyTo?: string;
}

export interface Conversation {
  otherParty: Core.Models.PublicKey.PublicKey;
  lastMessage?: {
    messageId: string;
    sender: Core.Models.PublicKey.PublicKey;
    timestamp: Date;
    // Note: content is encrypted, we can't display it in the conversation list
  };
  unreadCount: number;
}

export interface DMServerConfig {
  httpUrl: string;
  websocketUrl: string;
  maxMessageSize: number;
}

export interface X25519KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

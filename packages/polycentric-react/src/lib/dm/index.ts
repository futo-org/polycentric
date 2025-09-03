// Core DM client and utilities
export { DMClient } from './DMClient';
export { getDMServerConfig } from './dmServerConfig';
export { useDMClient } from './useDMClient';

// Types
export type {
  AuthChallenge,
  AuthRequest,
  DecryptedMessage,
  DMMessageContent,
  EncryptedMessage,
  X25519KeyPair,
} from './DMClient';

// Components (re-exported from components/dm)
export { ConversationList, DMChatComponent } from '../components/dm';
export type { Conversation } from '../types/dm';

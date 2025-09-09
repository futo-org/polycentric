// Core DM client and utilities
export { DMClient } from './DMClient';
export { getDMServerConfig } from './dmServerConfig';
export { useDMClient } from './useDMClient';

// Types (only export unique types from DMClient, not duplicates)
export type {
  AuthChallenge,
  AuthRequest
} from './DMClient';

// Components and shared types (re-exported from components/dm)
export { ConversationList, DMChatComponent } from '../components/dm';
export type {
  Conversation,
  DecryptedMessage,
  DMMessageContent,
  EncryptedMessage,
  X25519KeyPair
} from '../types/dm';


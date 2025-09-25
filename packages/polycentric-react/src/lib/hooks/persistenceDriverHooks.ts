/**
 * @fileoverview Persistence driver context for data storage abstraction.
 *
 * Key Design Decisions:
 * - Context-based dependency injection for persistence layer abstraction
 * - TypeScript ignore for context initialization (set at app root)
 * - Centralized persistence driver access for consistent data operations
 */

import { PersistenceDriver } from '@polycentric/polycentric-core';
import { createContext, useContext } from 'react';

export const PersistenceDriverContext =
  // @ts-ignore
  createContext<PersistenceDriver.IPersistenceDriver>();

// Persistence driver hook for accessing data storage operations
export const usePersistenceDriver = () => {
  return useContext(PersistenceDriverContext);
};

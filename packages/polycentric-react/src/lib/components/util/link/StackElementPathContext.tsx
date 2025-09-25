/**
 * @fileoverview Context for tracking stack element paths in navigation.
 */

import { createContext } from 'react';

// Context for tracking current stack element path in navigation stack
// @ts-ignore
export const StackElementPathContext = createContext<string>();

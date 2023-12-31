import { createContext } from 'react';

export const MemoryRoutedLinkContext = createContext<string | undefined>(
    undefined,
);

import { PersistenceDriver } from '@polycentric/polycentric-core';
import { createContext, useContext } from 'react';

// @ts-ignore
export const PersistenceDriverContext =
    createContext<PersistenceDriver.IPersistenceDriver>();

export const usePersistenceDriver = () => {
    return useContext(PersistenceDriverContext);
};

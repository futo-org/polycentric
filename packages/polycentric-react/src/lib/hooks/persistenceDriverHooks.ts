import { PersistenceDriver } from '@polycentric/polycentric-core';
import { createContext, useContext } from 'react';

export const PersistenceDriverContext =
// @ts-ignore
    createContext<PersistenceDriver.IPersistenceDriver>();

export const usePersistenceDriver = () => {
    return useContext(PersistenceDriverContext);
};

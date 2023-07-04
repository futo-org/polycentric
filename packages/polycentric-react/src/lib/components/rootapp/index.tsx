// export const RootApp = () => {
//     return (<div>xd</div>);
// }

// import { useView } from "../../hooks/viewHooks"

import {
    createBrowserRouter,
    RouterProvider,
    createHashRouter,
} from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { PersistenceDriver, ProcessHandle, MetaStore, View } from '@polycentric/polycentric-core';
import { useView, ViewContext } from '../../hooks/viewHooks.js';

const TestPage = () => {
    const view = useView();
    return <p>{JSON.stringify(view.processHandle.system())}</p>
}

// Check if we're in electron or not
const isElectron = () => {
    // window.process.type is only defined in electron
    // @ts-ignore
    return window && window.process && window.process.type;
}

const router = isElectron() ?
    createHashRouter([
        {
            path: "/",
            element: <TestPage />
        }
    ])
    : createBrowserRouter([
        {
            path: "/",
            element: <TestPage />
        }
    ]);

async function createProcessHandle(persistenceDriver: PersistenceDriver.IPersistenceDriver): Promise<ProcessHandle.ProcessHandle> {
    return await ProcessHandle.createProcessHandle(
        await MetaStore.createMetaStore(
            persistenceDriver),
    );
}

export const RootApp = ({
    persistenceDriver,
}: {
    persistenceDriver: PersistenceDriver.IPersistenceDriver
}) => {

    const [processHandle, setProcessHandle] = useState<ProcessHandle.ProcessHandle | undefined>(undefined);
    const [view, setView] = useState<View.View | undefined>(undefined);

    useEffect(() => {
        createProcessHandle(persistenceDriver)
            .then((ph) => {
                setProcessHandle(ph);
                setView(new View.View(ph));
            })
    }, [persistenceDriver]);

    if (processHandle === undefined) {
        return (<></>);
    }

    return (
        <ViewContext.Provider value={view}>
            <RouterProvider router={router} />
        </ViewContext.Provider>
    );
}

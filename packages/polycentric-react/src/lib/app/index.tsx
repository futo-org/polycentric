import {
    ArrowUpOnSquareIcon,
    EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import {
    IonApp,
    IonRouterOutlet,
    isPlatform,
    setupIonicReact,
} from '@ionic/react';
import {
    IonReactHashRouter,
    IonReactMemoryRouter,
    IonReactRouter,
} from '@ionic/react-router';
import {
    MetaStore,
    PersistenceDriver,
    ProcessHandle,
} from '@polycentric/polycentric-core';
import { createMemoryHistory } from 'history';
import { useEffect, useMemo, useState } from 'react';
import { SidebarLayout } from '../components/layout/sidebarlayout';
import { Onboarding } from '../components/onboarding';
import { AppRouter } from '../components/util/approuter';
import {
    OnboardingProcessHandleManagerContext,
    ProcessHandleManagerContext,
    useProcessHandleManagerBaseComponentHook,
} from '../hooks/processHandleManagerHooks';
import { QueryManagerContext } from '../hooks/queryHooks';

setupIonicReact({});

// Check if we're in electron or not
const isElectron = () => {
    // window.process.type is only defined in electron
    // @ts-ignore
    return window && window.process && window.process.type;
};

// @ts-ignore
// navigator.standalone isn't an official api yet
const isStandalonePWA = (): boolean => window.navigator.standalone ?? false;

const memoryHistory = createMemoryHistory();

const PlatformRouter = ({ children }: { children: React.ReactNode }) => {
    if (isElectron()) {
        return <IonReactHashRouter>{children}</IonReactHashRouter>;
    }

    if (isStandalonePWA()) {
        return (
            <IonReactMemoryRouter history={memoryHistory}>
                {children}
            </IonReactMemoryRouter>
        );
    }

    return <IonReactRouter>{children}</IonReactRouter>;
};

// Currently, Polycentric can only be used while signed in
export const SignedinApp = ({
    processHandle,
}: {
    processHandle: ProcessHandle.ProcessHandle;
}) => {
    const queryManager = useMemo(
        () => processHandle.queryManager,
        [processHandle],
    );

    return (
        <QueryManagerContext.Provider value={queryManager}>
            <PlatformRouter>
                <SidebarLayout>
                    <IonRouterOutlet id="main-drawer">
                        <AppRouter />
                    </IonRouterOutlet>
                </SidebarLayout>
            </PlatformRouter>
        </QueryManagerContext.Provider>
    );
};

const LoadedMetastoreApp = ({
    metaStore,
}: {
    metaStore: MetaStore.IMetaStore;
}) => {
    const storeManagerProps =
        useProcessHandleManagerBaseComponentHook(metaStore);

    const { processHandle, activeStore } = storeManagerProps;

    if (processHandle === undefined || activeStore === undefined) {
        return <p>loading</p>;
    } else if (processHandle === null || activeStore === null) {
        return (
            <OnboardingProcessHandleManagerContext.Provider
                value={storeManagerProps}
            >
                <Onboarding />
            </OnboardingProcessHandleManagerContext.Provider>
        );
    } else {
        return (
            // Typescript is dumb and doesn't understand that we've already checked for null
            // @ts-ignore
            <ProcessHandleManagerContext.Provider value={storeManagerProps}>
                <SignedinApp processHandle={processHandle} />
            </ProcessHandleManagerContext.Provider>
        );
    }
};

const AddToHomeScreenBarrier = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const showBarrier = useMemo(() => {
        return isPlatform('mobile') && !isPlatform('pwa');
    }, []);

    const isAndroid = useMemo(() => {
        return isPlatform('android');
    }, []);

    return (
        <>
            {showBarrier && (
                <div className="z-50 fixed w-full h-full bg-gray-600 bg-opacity-60 flex flex-col items-center p-10 pt-[33%]">
                    <div className="w-full p-10 aspect-square rounded-full bg-white overflow-hidden flex flex-col justify-center items-center space-y-2.5">
                        <h1 className="text-2xl text- font-medium break-words">
                            Add Polycentric to your home screen to continue
                        </h1>

                        {isAndroid ? (
                            <EllipsisVerticalIcon className="w-10 h-10 border rounded-full text-gray-500" />
                        ) : (
                            <ArrowUpOnSquareIcon className="w-10 h-10" />
                        )}
                    </div>
                </div>
            )}
            {children}
        </>
    );
};

export const App = ({
    persistenceDriver,
}: {
    persistenceDriver: PersistenceDriver.IPersistenceDriver;
}) => {
    const [metaStore, setMetaStore] = useState<MetaStore.IMetaStore>();

    useEffect(() => {
        MetaStore.createMetaStore(persistenceDriver).then((metaStore) =>
            setMetaStore(metaStore),
        );
    }, [persistenceDriver]);

    if (metaStore === undefined) {
        return <p>Loading...</p>;
    }

    return (
        <IonApp>
            <AddToHomeScreenBarrier>
                <LoadedMetastoreApp metaStore={metaStore} />
            </AddToHomeScreenBarrier>
        </IonApp>
    );
};

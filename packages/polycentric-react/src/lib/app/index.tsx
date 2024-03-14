import {
    ArrowUpOnSquareIcon,
    EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { IonApp, IonNav, isPlatform, setupIonicReact } from '@ionic/react';
import {
    MetaStore,
    PersistenceDriver,
    ProcessHandle,
} from '@polycentric/polycentric-core';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { SidebarLayout } from '../components/layout/sidebarlayout';
import { Onboarding } from '../components/onboarding';
import { MemoryRoutedComponent } from '../components/util/link';
import { PersistenceDriverContext } from '../hooks/persistenceDriverHooks';
import {
    BaseProcessHandleManagerContext,
    useProcessHandleManagerBaseComponentHook,
} from '../hooks/processHandleManagerHooks';
import { QueryManagerContext } from '../hooks/queryHooks';
import { useStackRouter } from '../hooks/stackRouterHooks';
import { createSwipeBackGesture } from '../util/ionicfullpageswipebackgesture';
import { StackRouterContext } from './StackRouterContext';

setupIonicReact({});

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

    const root = useCallback(() => {
        return <MemoryRoutedComponent routerLink={window.location.pathname} />;
    }, []);

    const ionNavRef = useRef<HTMLIonNavElement>(null);

    useLayoutEffect(() => {
        // Allow swiping back anywhere on page
        // The only other way to do this is to distribute our own ionic build
        // https://github.com/ionic-team/ionic-framework/blob/83f9ac0face445c7f4654dea1a6a43e4565fb800/core/src/components/nav/nav.tsx#L135
        // https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/gesture/swipe-back.ts

        if (!ionNavRef.current) return;

        const isIOS = isPlatform('ios');

        if (!isIOS) return;

        const gesture = createSwipeBackGesture(
            // @ts-ignore
            ionNavRef.current.el,
            (...args) => {
                // @ts-ignore
                // Don't ask me why this is necessary
                ionNavRef.current.swipeGesture = true;
                // @ts-ignore
                return ionNavRef.current.canStart(...args);
            },
            // @ts-ignore
            ionNavRef.current.onStart.bind(ionNavRef.current),
            // @ts-ignore
            ionNavRef.current.onMove.bind(ionNavRef.current),
            // @ts-ignore
            ionNavRef.current.onEnd.bind(ionNavRef.current),
            1000,
        );

        gesture.enable(true);

        return () => {
            gesture.destroy();
        };
    }, []);

    const stackRouter = useStackRouter(ionNavRef);

    const isFirefox = useMemo(() => {
        const userAgent = navigator.userAgent.toLowerCase();
        return userAgent.includes('firefox');
    }, []);

    return (
        <QueryManagerContext.Provider value={queryManager}>
            <StackRouterContext.Provider value={stackRouter}>
                <SidebarLayout>
                    <IonNav id="main-drawer" root={root} ref={ionNavRef} animated={!isFirefox} />
                </SidebarLayout>
            </StackRouterContext.Provider>
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
    } else {
        return (
            // Typescript is dumb and doesn't understand that we've already checked for null
            // @ts-ignore
            <BaseProcessHandleManagerContext.Provider value={storeManagerProps}>
                {processHandle === null || activeStore === null ? (
                    <Onboarding />
                ) : (
                    <SignedinApp processHandle={processHandle} />
                )}
            </BaseProcessHandleManagerContext.Provider>
        );
    }
};

const AddToHomeScreenBarrier = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const isDesktopSafari = useMemo(() => {
        const ua = navigator.userAgent.toLowerCase();
        const isSafari =
            ua.includes('safari') === true &&
            ua.includes('chrome') === false &&
            ua.includes('chromium') === false;
        const isDesktop = isPlatform('desktop');
        return isSafari && isDesktop;
    }, []);

    const showBarrier = useMemo(() => {
        return (isPlatform('mobile') && !isPlatform('pwa')) || isDesktopSafari;
    }, [isDesktopSafari]);

    const isAndroid = useMemo(() => {
        return isPlatform('android');
    }, []);

    return (
        <>
            {showBarrier && (
                <div className="z-50 fixed w-full h-full bg-gray-600 bg-opacity-60 flex flex-col items-center lg:just p-10 pt-[33%] lg:pt-10">
                    <div className="w-full lg:max-w-[28rem] p-10 aspect-square rounded-full bg-white overflow-hidden flex flex-col justify-center items-center space-y-2.5">
                        <h1 className="text-2xl text- font-medium break-words">
                            {isDesktopSafari
                                ? 'In order for Safari to persist your information, please add this page to your dock, or use a different browser to continue'
                                : 'Add Polycentric to your home screen to continue'}
                        </h1>

                        {isAndroid ? (
                            <EllipsisVerticalIcon className="w-10 h-10 border rounded-full text-gray-500" />
                        ) : !isDesktopSafari ? (
                            <ArrowUpOnSquareIcon className="w-10 h-10" />
                        ) : (
                            <></>
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
        <PersistenceDriverContext.Provider value={persistenceDriver}>
            <IonApp>
                <AddToHomeScreenBarrier>
                    <LoadedMetastoreApp metaStore={metaStore} />
                </AddToHomeScreenBarrier>
            </IonApp>
        </PersistenceDriverContext.Provider>
    );
};

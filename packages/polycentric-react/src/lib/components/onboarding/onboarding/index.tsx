import { encode } from '@borderless/base64';
import { isPlatform } from '@ionic/react';
import { Models } from '@polycentric/polycentric-core';
import {
    createContext,
    Dispatch,
    InputHTMLAttributes,
    ReactNode,
    SetStateAction,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import starterURL from '../../../../graphics/onboarding/starter.svg';
import { StackRouterContext } from '../../../app/contexts';
import { useGestureWall } from '../../../hooks/ionicHooks';
import { useOnboardingProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useIsMobile, useThemeColor } from '../../../hooks/styleHooks';
import { publishBlobToAvatar } from '../../../util/imageProcessing';
import { ProfileAvatarInput } from '../../profile/edit/inputs/ProfileAvatarInput';
import { Carousel } from '../../util/carousel';

const OnboardingPanel = ({
    children,
    imgSrc,
}: {
    children: ReactNode;
    imgSrc: string;
}) => (
    <div className="relative h-screen md:h-auto w-full flex flex-col justify- md:grid md:grid-cols-2 md:grid-rows-1 md:gap-5 md:px-14 md:py-10">
        <div className="border rounded-[2.5rem] bg-white">{children}</div>
        {/* Desktop graphic */}
        <br className="md:hidden" />
        <div className="hidden md:block w-full justify-center bg-[#0096E6] max-h-72 md:max-h-none rounded-[2.5rem] overflow-hidden">
            <img className="h-full" src={imgSrc} />
        </div>
        {/* Mobile graphic */}
        <div className="md:hidden absolute top-0 left-0 w-full h-full flex flex-col justify-end items-center bg-[#0096E6] -z-10">
            <img className="h-1/2" src={imgSrc} />
        </div>
    </div>
);

const WelcomePanel = ({ nextSlide }: { nextSlide: () => void }) => {
    const { setIsSigningIn } = useContext(SignInContext);

    return (
        <OnboardingPanel imgSrc={starterURL}>
            <div className="flex flex-col justify-between h-full p-10">
                <div className="flex flex-col justify-center h-full text-left space-y-10 md:space-y-4">
                    <div className="text-4xl md:font-6xl font-bold">
                        Welcome to Polycentric
                    </div>
                    <div className="text-gray-400 text-lg">
                        Posting for communities
                    </div>
                    <button
                        className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                        onClick={nextSlide}
                    >
                        Create Account (no email necessary)
                    </button>
                    <button
                        type="submit"
                        className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                        onClick={() => {
                            setIsSigningIn(true);
                            nextSlide();
                        }}
                    >
                        Sign in
                    </button>
                    <div className="text-gray-400 text-lg pt-20">
                        Note: Polycentric is still a work in progress, and data
                        on this version may be unavailable in the future
                    </div>
                </div>
            </div>
        </OnboardingPanel>
    );
};

const RequestNotificationsPanel = ({
    nextSlide,
}: {
    nextSlide: () => void;
}) => {
    const [state, setState] = useState<
        | 'init'
        | 'notifications_request_failed'
        | 'persist_call_failed'
        | 'persisted'
    >('init');

    useEffect(() => {
        // Check on an interval if the user enables notifications manually (since we can't listen for it)
        const interval = setInterval(() => {
            if (Notification.permission === 'granted') {
                clearInterval(interval);
                // It's fine if this races with the other call, since it's a noop if it's already persisted
                navigator.storage.persist().then((successfullyPersisted) => {
                    setState(
                        successfullyPersisted
                            ? 'persisted'
                            : 'persist_call_failed',
                    );
                });
            }
        }, 1000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    return (
        <OnboardingPanel imgSrc={starterURL}>
            <div className="flex flex-col p-10 gap-y-10 justify-center h-full">
                <div className="text-4xl font-bold">Enable Persistence</div>
                <p className="text-xl">
                    {
                        "To save your data, your browser needs you to enable notifications (we won't send you any)."
                    }
                </p>
                <button
                    disabled={
                        state === 'persist_call_failed' || state === 'persisted'
                    }
                    className="bg-blue-500 disabled:bg-blue-200 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                    onClick={async () => {
                        const permission =
                            await Notification.requestPermission();

                        if (permission === 'denied') {
                            setState('notifications_request_failed');
                            return;
                        } else {
                            navigator.storage
                                .persist()
                                .then((successfullyPersisted) => {
                                    setState(
                                        successfullyPersisted
                                            ? 'persisted'
                                            : 'persist_call_failed',
                                    );
                                });
                        }
                    }}
                >
                    Request notifications
                </button>
                <button
                    disabled={state !== 'persisted'}
                    onClick={nextSlide}
                    className="bg-blue-500 disabled:bg-blue-200 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                >
                    {state === 'notifications_request_failed'
                        ? 'Notifications request denied'
                        : state === 'persist_call_failed'
                        ? 'Something went wrong'
                        : 'Continue'}
                </button>
            </div>
        </OnboardingPanel>
    );
};

const RequestPersistencePanel = ({ nextSlide }: { nextSlide: () => void }) => {
    const [state, setState] = useState<
        'init' | 'persist_call_failed' | 'persisted'
    >('init');

    useEffect(() => {
        // Check on an interval if the user enables notifications manually (since we can't listen for it)
        const interval = setInterval(() => {
            navigator.storage.persisted().then((persisted) => {
                if (persisted) {
                    clearInterval(interval);
                    setState('persisted');
                }
            });
        }, 1000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    return (
        <OnboardingPanel imgSrc={starterURL}>
            <div className="flex flex-col p-10 gap-y-10 justify-center h-full">
                <div className="text-4xl font-bold">Enable Persistence</div>
                <p className="text-xl">
                    {'To save your data, please enable persistence.'}
                </p>
                <button
                    disabled={
                        state === 'persisted' || state === 'persist_call_failed'
                    }
                    className="bg-blue-500 disabled:bg-blue-200 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                    onClick={() => {
                        navigator.storage.persist().then((persisted) => {
                            setState(
                                persisted ? 'persisted' : 'persist_call_failed',
                            );
                        });
                    }}
                >
                    {state === 'persist_call_failed'
                        ? "Please enable persistence in your browser's settings"
                        : 'Enable persistence'}
                </button>
                <button
                    disabled={state !== 'persisted'}
                    onClick={nextSlide}
                    className="bg-blue-500 disabled:bg-blue-200 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                >
                    {state === 'persist_call_failed'
                        ? 'Persistence request denied'
                        : 'Continue'}
                </button>
            </div>
        </OnboardingPanel>
    );
};

const GenCredsPanelItem = ({
    title,
    hint,
    ...rest
}: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    title: string;
    hint?: string;
    autoComplete?: string;
    readOnly?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) => (
    <div className="flex flex-col gap-y-1">
        <h3 className="font-medium">{title}</h3>
        <input
            type="text"
            className="rounded-lg border text-xl p-3"
            {...rest}
        />
        <p className="text-sm text-gray-700">{hint}</p>
    </div>
);

const CredsPanelSignUp = () => {
    const [avatar, setAvatar] = useState<Blob>();
    const [privateKey] = useState(Models.PrivateKey.random());
    const [username, setUsername] = useState('');
    const { createHandle } = useOnboardingProcessHandleManager();

    const stackRouterContext = useContext(StackRouterContext);

    return (
        <form
            className="contents"
            onSubmit={async (e) => {
                e.preventDefault();

                const defaultServers: Array<string> =
                    import.meta.env.VITE_DEFAULT_SERVERS?.split(',') ?? [];
                const processHandle = await createHandle(
                    privateKey,
                    defaultServers,
                    username,
                );

                if (stackRouterContext?.history) {
                    // if we're here, we're already signed in to another account. go to feed
                    stackRouterContext.setRoot('/', 'forwards');
                }

                if (avatar) await publishBlobToAvatar(avatar, processHandle);

                // if supported, save private key to credential manager api
                // @ts-ignore
                if (window.PasswordCredential) {
                    // @ts-ignore
                    const cred = new window.PasswordCredential({
                        name: username,
                        id: encode(processHandle.system().key),
                        password: encode(privateKey.key),
                    });
                    navigator.credentials.store(cred);
                }
            }}
        >
            <ProfileAvatarInput
                title="Upload a profile picture (optional)"
                hint="You can change this later"
                setCroppedImage={setAvatar}
            />
            <GenCredsPanelItem
                title="What's your username?"
                hint="You can change this later"
                value={username}
                required={true}
                onChange={(e) => setUsername(e.target.value)}
            />
            <GenCredsPanelItem
                title="This is your password. Save it now."
                autoComplete="password"
                value={encode(privateKey.key)}
                readOnly={true}
            />
            <button
                type="submit"
                className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
            >
                Lets go
            </button>
        </form>
    );
};

const CredsPanelSignIn = () => {
    const { createHandleFromExportBundle } =
        useOnboardingProcessHandleManager();

    const [backupKey, setBackupKey] = useState<string>('');
    const [backupKeyError, setBackupKeyError] = useState<string | null>(null);
    const stackRouterContext = useContext(StackRouterContext);

    return (
        <div className="contents">
            <GenCredsPanelItem
                title="What's your Polycentric backup key?"
                value={backupKey}
                placeholder="polycentric://"
                onChange={(e) => {
                    if (backupKeyError) setBackupKeyError(null);
                    setBackupKey(e.target.value);
                }}
            />
            <div>
                <button
                    type="submit"
                    className="bg-blue-500 disabled:bg-blue-200 text-white disabled:text-gray-50 border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                    disabled={
                        backupKeyError != null ||
                        backupKey.length === 0 ||
                        backupKey.startsWith('polycentric://') === false
                    }
                    onClick={() => {
                        createHandleFromExportBundle(backupKey)
                            .then(() => {
                                if (stackRouterContext?.history) {
                                    stackRouterContext.setRoot('/', 'forwards');
                                }
                            })
                            .catch((e) => {
                                setBackupKeyError(e.message);
                                console.error(e);
                            });
                    }}
                >
                    Sign in
                </button>
                {backupKeyError && (
                    <div className="relative">
                        {/* Only do absolute so we don't move the centered content on error */}
                        <p className="mt-5 absolute text-red-900 text-sm">
                            {backupKeyError}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

const CredsPanel = ({}: { nextSlide: () => void }) => {
    const { isSigningIn, setIsSigningIn } = useContext(SignInContext);

    return (
        <OnboardingPanel imgSrc={starterURL}>
            <div className="flex flex-col justify-center h-full p-10 gap-y-5">
                <div className="md:-mt-[5rem]">
                    <button
                        className="float-right bg-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
                        onClick={() => setIsSigningIn((cur) => !cur)}
                    >
                        {isSigningIn ? 'Sign up' : 'Sign in'}
                    </button>
                </div>
                {isSigningIn === false ? (
                    <CredsPanelSignUp />
                ) : (
                    <CredsPanelSignIn />
                )}
            </div>
        </OnboardingPanel>
    );
};

const OnboardingBackButton = () => {
    const history = useContext(StackRouterContext)?.history;
    return (
        <button
            className="absolute top-5 left-5 bg-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg z-20"
            onClick={() => {
                if (history.length > 1) {
                    history.pop();
                } else {
                    history.push('/');
                }
            }}
        >
            Go back
        </button>
    );
};

// This is a hack for now
const SignInContext = createContext<{
    isSigningIn: boolean;
    setIsSigningIn: Dispatch<SetStateAction<boolean>>;
}>({ isSigningIn: false, setIsSigningIn: () => {} });

export const Onboarding = () => {
    useThemeColor('#0096E6');
    useGestureWall();

    const [alreadyPersisted, setAlreadyPersisted] = useState(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    // @ts-ignore
    const isChromium = !!window.chrome;

    useEffect(() => {
        const checkAndTryToPersist = async () => {
            navigator.storage.persisted().then((persisted) => {
                setAlreadyPersisted(persisted);

                // In case we don't have persistence, but we already have notifications on chromium
                if (
                    persisted === false &&
                    isChromium &&
                    Notification.permission === 'granted'
                ) {
                    navigator.storage.persist();
                    setAlreadyPersisted(true);
                }
                // Chromium browsers will also allow persist calls without notifications when sites are installed
                else if (
                    isChromium &&
                    window.matchMedia('(display-mode: standalone)').matches
                ) {
                    navigator.storage.persist();
                    setAlreadyPersisted(true);
                }
            });
        };

        if (isPlatform('capacitor')) {
            setAlreadyPersisted(true);
            return;
        }

        checkAndTryToPersist();
        window.addEventListener('appinstalled', checkAndTryToPersist);

        return () => {
            window.removeEventListener('appinstalled', checkAndTryToPersist);
        };
    }, [isChromium]);

    const isMobile = useIsMobile();

    const RequestPersistenceComponent = isChromium
        ? RequestNotificationsPanel
        : RequestPersistencePanel;

    const childComponents = useMemo(
        () => [
            WelcomePanel,
            // I literally submitted a proposal to the EMCAscript spec to avoid this syntax but it got rejected
            // https://es.discourse.group/t/conditionally-add-elements-to-declaratively-defined-arrays/1041
            ...(alreadyPersisted ? [] : [RequestPersistenceComponent]),
            CredsPanel,
        ],
        [alreadyPersisted, RequestPersistenceComponent],
    );

    const history = useContext(StackRouterContext)?.history;
    const showBackButton =
        history !== undefined && history?.length > 1 && isMobile;

    return (
        <SignInContext.Provider value={{ isSigningIn, setIsSigningIn }}>
            <div className="md:flex justify-center items-center relative bg-[#0096E6] md:bg-white">
                {
                    // @ts-ignore
                    showBackButton && <OnboardingBackButton />
                }
                <Carousel
                    swiperClassName={showBackButton ? 'mt-20' : undefined}
                    childComponents={childComponents}
                    className="w-full md:max-w-7xl"
                />
            </div>
        </SignInContext.Provider>
    );
};

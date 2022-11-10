import { memo, useState } from 'react';
import {
    BrowserRouter,
    HashRouter,
    Routes,
    Route,
    Navigate,
} from 'react-router-dom';

import './index.css';
import App from './App';
import EditProfile from './EditProfile';
import Following from './Following';
import Setup from './Setup';
import Search from './Search';
import Notifications from './Notifications';
import { Feed } from './Feed';
import * as Explore from './Explore';
import * as About from './About';
import * as Core from 'polycentric-core';
import * as Profiles from './Profiles';

export const PolycentricRoutesMemo = memo(PolycentricRoutes);

export type PolycentricRoutesProps = {
    initialState: Core.DB.PolycentricState | undefined;
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver;
    metaStore: Core.PersistenceDriver.IMetaStore;
    isElectron: boolean;
    existingProfiles: boolean;
};

export function PolycentricRoutes(props: PolycentricRoutesProps) {
    const [polycentricState, setPolycentricState] = useState<
        Core.DB.PolycentricState | undefined
    >(props.initialState);

    const handleSetState = (
        state: Core.DB.PolycentricState | undefined,
    ): void => {
        setPolycentricState(state);
    };

    const redirect = props.existingProfiles ? (
        <Navigate to="/profiles" />
    ) : (
        <Navigate to="/setup" />
    );

    const redirectToFeed = <Navigate to="/" />;

    const PolycentricRoutes = () => (
        <Routes>
            <Route
                path="/"
                element={
                    <App
                        state={polycentricState}
                        setState={handleSetState}
                        metaStore={props.metaStore}
                    />
                }
            >
                <Route
                    path="/explore"
                    element={
                        polycentricState ? (
                            <Explore.ExploreMemo state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/notifications"
                    element={
                        polycentricState ? (
                            <Notifications state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/"
                    element={
                        polycentricState ? (
                            <Feed state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/profile"
                    element={
                        polycentricState ? (
                            <EditProfile state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/search"
                    element={
                        polycentricState ? (
                            <Search state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/search/:search"
                    element={
                        polycentricState ? (
                            <Search state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/following"
                    element={
                        polycentricState ? (
                            <Following state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/about"
                    element={
                        polycentricState ? (
                            <About.About state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
                <Route
                    path="/setup"
                    element={
                        polycentricState ? (
                            redirectToFeed
                        ) : (
                            <Setup
                                setState={handleSetState}
                                persistenceDriver={props.persistenceDriver}
                                metaStore={props.metaStore}
                            />
                        )
                    }
                />
                <Route
                    path="/profiles"
                    element={
                        polycentricState ? (
                            redirectToFeed
                        ) : (
                            <Profiles.ProfilesMemo
                                setState={handleSetState}
                                persistenceDriver={props.persistenceDriver}
                                metaStore={props.metaStore}
                            />
                        )
                    }
                />
                <Route
                    path=":feed"
                    element={
                        polycentricState ? (
                            <Feed state={polycentricState} />
                        ) : (
                            redirect
                        )
                    }
                />
            </Route>
        </Routes>
    );

    if (props.isElectron === true) {
        return (
            <HashRouter>
                {' '}
                <PolycentricRoutes />{' '}
            </HashRouter>
        );
    } else {
        return (
            <BrowserRouter>
                {' '}
                <PolycentricRoutes />{' '}
            </BrowserRouter>
        );
    }
}

import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AppBar, Toolbar, ThemeProvider, createTheme } from '@mui/material';

import * as Core from 'polycentric-core';
import PostModal from './PostModal';
import './App.css';

const theme = createTheme({
    palette: {
        primary: {
            main: '#3897D9',
        },
        secondary: {
            main: '#64D98A',
        },
        error: {
            main: '#64D98A',
        },
    },
});

type AppProps = {
    state: Core.DB.PolycentricState;
};

function App(props: AppProps) {
    const [modalIsOpen, setModalIsOpen] = useState(false);
    const [initial, setInitial] = useState(true);

    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (
            location.pathname !== '/setup' &&
            props.state.identity === undefined
        ) {
            navigate('/setup');
        }

        setInitial(false);
    }, [location, navigate, props.state.identity]);

    return (
        <div>
            <ThemeProvider theme={theme}>
                {props.state.identity !== undefined && (
                    <AppBar position="sticky">
                        <Toolbar className="app__header">
                            <Link to="/">Feed</Link>
                            <Link to="/profile">Profile</Link>
                            <Link to="/following">Following</Link>
                            <Link to="/search">Search</Link>
                            <a
                                onClick={() => {
                                    setModalIsOpen(true);
                                }}
                            >
                                Post
                            </a>
                        </Toolbar>
                    </AppBar>
                )}

                <PostModal
                    state={props.state}
                    isOpen={modalIsOpen}
                    onClose={() => {
                        setModalIsOpen(false);
                    }}
                />

                {initial === false && (
                    <div className="app">
                        <Outlet />
                    </div>
                )}
            </ThemeProvider>
        </div>
    );
}

export default App;

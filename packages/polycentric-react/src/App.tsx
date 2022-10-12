import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AppBar, Toolbar, ThemeProvider, Tooltip, IconButton, Avatar, Box, createTheme } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';

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
    const [avatar, setAvatar] = useState<string | undefined>(undefined);

    const location = useLocation();
    const navigate = useNavigate();

    const handleOpenProfile = () => {
        navigate('/profile');
    };

    const handleOpenNotifications = () => {
        navigate('/notifications');
    };

    const loadProfileImage = async () => {
        if (props.state.identity === undefined) {
            return;
        }

        const profile = await Core.DB.loadProfile(props.state);

        if (profile.imagePointer === undefined) {
            return;
        }

        const loaded = await Core.DB.loadBlob(
            props.state,
            profile.imagePointer,
        );

        if (loaded === undefined) {
            return;
        }

        setAvatar(Core.Util.blobToURL(loaded.kind, loaded.blob));
    };

    useEffect(() => {
        if (
            location.pathname !== '/setup' &&
            props.state.identity === undefined
        ) {
            navigate('/setup');
        }

        setInitial(false);
    }, [location, navigate, props.state.identity]);

    useEffect(() => {
        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            loadProfileImage();
        };

        props.state.level.on('put', handlePut);

        loadProfileImage();

        return () => {
            props.state.level.removeListener('put', handlePut);
        };
    }, []);

    return (
        <div>
            <ThemeProvider theme={theme}>
                {props.state.identity !== undefined && (
                    <AppBar position="sticky">
                        <Toolbar>
                            <Box
                                className="app__header"
                            >
                                <Link to="/explore">Explore</Link>
                                <Link to="/">Feed</Link>
                                <Link to="/following">Following</Link>
                                <Link to="/search">Search</Link>
                                <a
                                    onClick={() => {
                                        setModalIsOpen(true);
                                    }}
                                >
                                    Post
                                </a>
                            </Box>
                            <Box sx={{ flexGrow: 1 }} />
                            <Box>
                                <Tooltip title="Open Notifications">
                                    <IconButton
                                        onClick={handleOpenNotifications}
                                        sx={{
                                            p: 0,
                                            marginRight: '15px',
                                        }}
                                        size="large"
                                        color="inherit"
                                    >
                                        <NotificationsIcon />
                                    </IconButton>
                                </Tooltip> 
                                <Tooltip title="Open Profile">
                                    <IconButton
                                        onClick={handleOpenProfile}
                                        sx={{ p: 0 }}
                                        size="large"
                                        color="inherit"
                                    >
                                        <Avatar
                                            alt="avatar"
                                            src={avatar}
                                        />
                                    </IconButton>
                                </Tooltip>
                            </Box>
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

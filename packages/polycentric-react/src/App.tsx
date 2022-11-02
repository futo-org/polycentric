import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
    AppBar,
    Toolbar,
    ThemeProvider,
    Tooltip,
    IconButton,
    Avatar,
    Box,
    Menu,
    MenuItem,
    Typography,
    Fab,
    createTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EditIcon from '@mui/icons-material/Edit';

import * as Core from 'polycentric-core';
import PostModal from './PostModal';
import * as ProfileUtil from './ProfileUtil';
import './App.css';

const theme = createTheme({
    palette: {
        primary: {
            main: '#3897D9',
        },
        secondary: {
            main: '#64D98A',
        },
        warning: {
            main: '#64D98A',
        },
        error: {
            main: '#8B0000',
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
    const [anchor, setAnchor] = useState<null | HTMLElement>(null);

    const location = useLocation();
    const navigate = useNavigate();

    const handleOpenProfile = () => {
        navigate('/profile');
        setAnchor(null);
    };

    const handleOpenNotifications = () => {
        navigate('/notifications');
        setAnchor(null);
    };

    const handleOpenFollowing = () => {
        navigate('/following');
        setAnchor(null);
    };

    const handleOpenAbout = () => {
        navigate('/about');
        setAnchor(null);
    };

    const handleOpenMyPosts = () => {
        if (props.state.identity !== undefined) {
            navigate(
                '/' +
                    ProfileUtil.profileToLinkOnlyKey(
                        props.state.identity.publicKey,
                    ),
            );
            setAnchor(null);
        }
    };

    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchor(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchor(null);
    };

    const handleOpenPostModal = () => {
        setModalIsOpen(true);
    };

    const loadProfileImage = async () => {
        if (props.state.identity === undefined) {
            return;
        }

        const profile = await Core.DB.loadProfile(props.state);

        if (profile.imagePointer === undefined) {
            return;
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const loaded = await Core.DB.loadBlob(
            props.state,
            profile.imagePointer,
            dependencyContext,
        );

        dependencyContext.cleanup();

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
                            <Box className="app__header">
                                <Link to="/explore">Explore</Link>
                                <Link to="/">Feed</Link>
                                <Link to="/search">Search</Link>
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
                                <Tooltip title="Open Menu">
                                    <IconButton
                                        onClick={handleOpenMenu}
                                        sx={{ p: 0 }}
                                        size="large"
                                        color="inherit"
                                    >
                                        <Avatar alt="avatar" src={avatar} />
                                    </IconButton>
                                </Tooltip>
                                <Menu
                                    sx={{ mt: '45px' }}
                                    anchorEl={anchor}
                                    open={Boolean(anchor)}
                                    onClose={handleCloseMenu}
                                    anchorOrigin={{
                                        vertical: 'top',
                                        horizontal: 'right',
                                    }}
                                    keepMounted
                                    transformOrigin={{
                                        vertical: 'top',
                                        horizontal: 'right',
                                    }}
                                >
                                    <MenuItem onClick={handleOpenMyPosts}>
                                        <Typography textAlign="center">
                                            My Posts
                                        </Typography>
                                    </MenuItem>
                                    <MenuItem onClick={handleOpenProfile}>
                                        <Typography textAlign="center">
                                            Edit Profile
                                        </Typography>
                                    </MenuItem>
                                    <MenuItem onClick={handleOpenFollowing}>
                                        <Typography textAlign="center">
                                            Following
                                        </Typography>
                                    </MenuItem>
                                    <MenuItem onClick={handleOpenAbout}>
                                        <Typography textAlign="center">
                                            About
                                        </Typography>
                                    </MenuItem>
                                </Menu>
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

                {props.state.identity !== undefined && (
                    <Fab
                        color="primary"
                        size="large"
                        style={{
                            position: 'fixed',
                            right: '30px',
                            bottom: '30px',
                        }}
                        onClick={handleOpenPostModal}
                    >
                        <EditIcon />
                    </Fab>
                )}
            </ThemeProvider>
        </div>
    );
}

export default App;

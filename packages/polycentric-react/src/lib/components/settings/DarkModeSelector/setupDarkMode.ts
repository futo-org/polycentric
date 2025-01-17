import {
    disable as disableDarkMode,
    enable as enableDarkMode,
    auto as followSystemColorScheme,
} from 'darkreader';

export const setupDarkMode = () => {
    const darkReaderConfig = {
        brightness: 100,
        contrast: 90,
        sepia: 10,
    };
    const darkModeSetting = localStorage.getItem('darkMode');
    if (darkModeSetting === 'on') {
        enableDarkMode(darkReaderConfig);
    } else if (darkModeSetting === 'off') {
        disableDarkMode();
    } else {
        followSystemColorScheme(darkReaderConfig);
    }
};

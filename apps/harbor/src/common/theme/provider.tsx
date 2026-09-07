import { Fonts } from '@/src/common/assets';
import { isWeb } from '@/src/common/util/platform';
import { useFonts } from 'expo-font';
import {
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
  useSyncExternalStore,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { useSettings } from '@/src/common/settings';
import { themes, type Theme, type ThemeKey } from './themes';

export type ThemeContextValue = {
  theme: Theme;
  activeThemeName: ThemeKey;
  setActiveThemeName: (name: ThemeKey) => void;
};

export const Context = createContext<ThemeContextValue | undefined>(undefined);
Context.displayName = 'PolycentricThemeContext';

export function ThemeProvider({ children }: PropsWithChildren) {
  // Web declares its own @font-face in `+html.tsx`.
  const [fontsLoaded, fontError] = useFonts(isWeb ? {} : Fonts);

  const colorScheme = useColorScheme();
  const storedTheme = useSettings((s) => s.theme);

  // Server snapshot is `false` so the first client render matches the
  // SSR shell; React re-renders with the real value right after hydration.
  const hydrated = useSyncExternalStore(
    useSettings.persist.onFinishHydration,
    useSettings.persist.hasHydrated,
    () => false,
  );

  const activeThemeName = hydrated
    ? storedTheme
    : colorScheme === 'dark'
      ? 'dark'
      : 'light';

  const setActiveThemeName = useCallback((name: ThemeKey) => {
    useSettings.getState().setTheme(name);
  }, []);

  const theme = useMemo(() => themes[activeThemeName], [activeThemeName]);

  // Keep the native window background in sync with the theme so the
  // moments where no surface has painted (splash dismissal, stack
  // transitions) don't flash the default white window. The interface style
  // drives system chrome (liquid glass tab bars, sheets, keyboard), which
  // follows the OS scheme unless overridden.
  useEffect(() => {
    if (!isWeb) Appearance.setColorScheme(theme.scheme);
    void SystemUI.setBackgroundColorAsync(theme.palette.neutral_0);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, activeThemeName, setActiveThemeName }),
    [theme, activeThemeName, setActiveThemeName],
  );

  if (fontError) {
    throw fontError;
  }

  if (!fontsLoaded || !hydrated) {
    return null;
  }

  const navTheme: typeof DefaultTheme = {
    dark: theme.scheme === 'dark',
    colors: {
      primary: theme.palette.primary_500,
      background: theme.palette.neutral_0,
      card: theme.palette.neutral_25,
      text: theme.palette.neutral_1000,
      border: theme.palette.neutral_200,
      notification: theme.palette.negative_500,
    },
    fonts: DefaultTheme.fonts,
  };

  return (
    <Context.Provider value={value}>
      <NavigationThemeProvider value={navTheme}>
        {children}
      </NavigationThemeProvider>
    </Context.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

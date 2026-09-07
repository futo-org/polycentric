import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'fs';

const { version: PKG_VERSION } = require('./package.json');

// 'dev' | 'staging' | 'production'. Staging comes from the eas.json
// profile env; dev from the local scripts.
const VARIANT = process.env.APP_VARIANT ?? 'production';

// 'apk' | 'store'. Store builds (Play/App Store) must not self-update —
// Play App Signing uses a different certificate, so a sideloaded APK
// can never install over them.
const DISTRIBUTION = process.env.APP_DISTRIBUTION ?? 'apk';
const IS_DEV = VARIANT === 'dev';
const IS_STAGING = VARIANT === 'staging';

const NAME = IS_DEV ? 'Harbor Dev' : IS_STAGING ? 'Harbor Staging' : 'Harbor';
const ID = IS_DEV
  ? 'org.futo.polycentric.dev'
  : IS_STAGING
    ? 'org.futo.polycentric.staging'
    : 'org.futo.polycentric';

const SCHEME = IS_DEV ? 'harbor.dev' : IS_STAGING ? 'harbor.staging' : 'harbor';

// Play builds get their own package so the store channel can never
// entangle with sideloaded installs (versionCodes and signatures stay
// fully independent). iOS keeps `ID` — the App Store app is bound to it.
const ANDROID_ID = !IS_DEV && DISTRIBUTION === 'store' ? `${ID}.store` : ID;

const GOOGLE_SERVICES_FILE =
  process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
// The google-services gradle plugin fails the build when the file has no
// entry for the package, so skip it for uncovered variants.
const HAS_GOOGLE_SERVICES = (() => {
  try {
    const config = JSON.parse(fs.readFileSync(GOOGLE_SERVICES_FILE, 'utf8'));
    return (config.client ?? []).some(
      (client: {
        client_info?: { android_client_info?: { package_name?: string } };
      }) =>
        client.client_info?.android_client_info?.package_name === ANDROID_ID,
    );
  } catch {
    return false;
  }
})();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: 'polycentric',
  version: process.env.APP_VERSION || PKG_VERSION || '0.0.1',
  orientation: 'default',
  icon: './src/common/assets/images/app-icons/android-icon-foreground.png',
  scheme: SCHEME,
  web: {
    output: 'server',
  },
  userInterfaceStyle: 'automatic',
  ios: {
    icon: {
      dark: './src/common/assets/images/app-icons/ios-icon-dark.png',
      light: './src/common/assets/images/app-icons/ios-icon-default.png',
      tinted: './src/common/assets/images/app-icons/ios-icon-monochrome.png',
    },
    requireFullScreen: true,
    supportsTablet: true,
    bundleIdentifier: ID,
    infoPlist: {
      NSCameraUsageDescription: '$(PRODUCT_NAME) needs access to your Camera.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage:
        './src/common/assets/images/app-icons/android-icon-foreground.png',
      monochromeImage:
        './src/common/assets/images/app-icons/android-icon-monochrome.png',
      backgroundImage:
        './src/common/assets/images/app-icons/android-icon-background.png',
      backgroundColor: '#FF6A00',
    },
    package: ANDROID_ID,
    permissions: [
      'android.permission.CAMERA',
      // Self-updater hands downloaded APKs to the system installer.
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ],
    ...(HAS_GOOGLE_SERVICES && { googleServicesFile: GOOGLE_SERVICES_FILE }),
  },
  plugins: [
    [
      'expo-router',
      {
        origin: 'https://harbor.social',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './src/common/assets/images/app-icons/ios-icon-default.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#FF6A00',
      },
    ],
    'expo-font',
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-dev-client',
      {
        launchMode: 'most-recent',
        // The generated scheme is slug-based, so all variants would claim it.
        addGeneratedScheme: false,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          buildArchs: ['arm64-v8a'],
        },
      },
    ],
    'expo-image',
    'expo-notifications',
    [
      'expo-screen-orientation',
      {
        initialOrientation: 'DEFAULT',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    variant: VARIANT,
    distribution: DISTRIBUTION,
    eas: {
      projectId: '4db035ec-2de9-448a-a6cf-07347d6ae8b9',
    },
  },
  owner: 'futo-org',
});

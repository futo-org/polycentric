import { publicEnv } from '@/src/common/util/env';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** Build variant. Web reads it at runtime since one image serves every environment. */
export const APP_VARIANT: string =
  publicEnv('EXPO_PUBLIC_APP_VARIANT', process.env.EXPO_PUBLIC_APP_VARIANT) ??
  Constants.expoConfig?.extra?.variant ??
  'production';

/** Same shape as the native ids in app.config.ts, with a `.web` suffix. */
export function webApplicationId(variant: string): string {
  const suffix = variant === 'production' ? '' : `.${variant}`;
  return `org.futo.polycentric${suffix}.web`;
}

/** Stamped on every event this install authors. */
export const HARBOR_APPLICATION = {
  name: 'Harbor',
  id: Application.applicationId ?? webApplicationId(APP_VARIANT),
  version:
    Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '',
  url: 'https://harbor.social',
};

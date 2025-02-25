import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.futo.polycentric',
  appName: 'Polycentric',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  // ios: {
  //   contentInset: 'always'
  // }
};

export default config;

import { webApplicationId } from './application';

jest.mock('expo-application', () => ({
  applicationId: null,
  nativeApplicationVersion: null,
}));
jest.mock('expo-constants', () => ({ expoConfig: {} }));

describe('webApplicationId', () => {
  it('drops the suffix for production', () => {
    expect(webApplicationId('production')).toBe('org.futo.polycentric.web');
  });

  it('inserts the variant otherwise', () => {
    expect(webApplicationId('staging')).toBe(
      'org.futo.polycentric.staging.web',
    );
    expect(webApplicationId('dev')).toBe('org.futo.polycentric.dev.web');
  });
});

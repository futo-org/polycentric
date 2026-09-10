jest.mock('@/src/common/theme', () => ({
  useTheme: () => ({
    theme: {
      palette: new Proxy({}, { get: () => '#000' }),
      atoms: { bg: { backgroundColor: '#fff' } },
    },
  }),
  Atoms: new Proxy({}, { get: () => ({}) }),
  Spacing: new Proxy({}, { get: () => 0 }),
}));

jest.mock('@/src/common/components', () => {
  const react = require('react');
  const rn = require('react-native');
  const passthrough = ({ children }: { children?: unknown }) =>
    react.createElement(rn.View, null, children);
  const Screen = passthrough as unknown as { PrimaryColumn: unknown };
  Screen.PrimaryColumn = passthrough;
  return {
    Screen,
    ScreenHeader: ({ title }: { title: string }) =>
      react.createElement(rn.Text, null, title),
    ListItemGroup: ({
      label,
      children,
    }: {
      label: string;
      children?: unknown;
    }) =>
      react.createElement(
        rn.View,
        null,
        react.createElement(rn.Text, null, label),
        children,
      ),
    ListItem: passthrough,
    LinkButton: ({ title }: { title: string }) =>
      react.createElement(rn.Text, null, title),
    Text: ({ children }: { children?: unknown }) =>
      react.createElement(rn.Text, null, children),
  };
});

jest.mock('@/src/common/lib/navigation/usePageTitle', () => ({
  usePageTitle: () => {},
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { render } from '@testing-library/react-native';
import LegalNoticesScreen from './LegalNoticesScreen';
import { LEGAL_NOTICES } from './legalNotices';

describe('LegalNoticesScreen', () => {
  it('lists every required attribution', async () => {
    const { getByText, getAllByText } = await render(<LegalNoticesScreen />);
    getByText('Legal notices');
    for (const notice of LEGAL_NOTICES) {
      getAllByText(notice.name);
      getByText(notice.attribution);
    }
  });
});

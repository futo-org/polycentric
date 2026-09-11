import { render } from '@testing-library/react-native';
import { Text } from './Text';

jest.mock('@/src/common/theme', () => {
  const actual = jest.requireActual('@/src/common/theme');
  return {
    ...actual,
    useTheme: () => ({ theme: actual.themes.light }),
  };
});

const emojiImages = (json: unknown): string[] => {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const el = node as {
      props?: { testID?: string; accessibilityLabel?: string };
      children?: unknown[];
    };
    if (el.props?.testID === 'emoji') {
      found.push(el.props.accessibilityLabel ?? '');
    }
    for (const child of el.children ?? []) walk(child);
  };
  walk(json);
  return found;
};

describe('Text', () => {
  it('replaces emoji with Twemoji images', async () => {
    const { toJSON } = await render(<Text>hi 👋 there 🐈</Text>);
    expect(emojiImages(toJSON())).toEqual(['👋', '🐈']);
  });

  it('leaves plain text alone', async () => {
    const { toJSON } = await render(<Text>1 + 1 → 2</Text>);
    expect(emojiImages(toJSON())).toEqual([]);
  });

  it('handles mixed children', async () => {
    const { toJSON } = await render(
      <Text>
        {'a 🐈 '}
        <Text>nested 🎉</Text>
      </Text>,
    );
    expect(emojiImages(toJSON())).toEqual(['🐈', '🎉']);
  });
});

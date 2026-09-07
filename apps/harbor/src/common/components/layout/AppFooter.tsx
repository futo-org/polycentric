import Icon from '@/src/common/components/Icon';
import { ExternalLink } from '@/src/common/components/primitives';
import { Atoms, typography, useTheme } from '@/src/common/theme';
import type { ExternalPathString } from 'expo-router';
import { type ComponentProps, useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { FUTO_URL } from '../../constants';

const LINKS: { text: string; href: ExternalPathString }[] = [
  {
    text: 'Privacy Policy',
    href: 'https://join.harbor.social/docs/privacy-policy/',
  },
  {
    text: 'Source Code',
    href: 'https://gitlab.futo.org/polycentric/polycentric',
  },
  { text: 'FUTO © 2026.', href: FUTO_URL },
];

/**
 * Theme toggle and external links row, shown at the bottom of the right
 * sidebar and on the onboarding welcome screen.
 */
export function AppFooter({ style, ...props }: ComponentProps<typeof View>) {
  const { theme, setActiveThemeName } = useTheme();

  const toggleTheme = useCallback(() => {
    const next = theme.name === 'dark' ? 'light' : 'dark';
    setActiveThemeName(next);
  }, [setActiveThemeName, theme.name]);

  return (
    <View
      style={[
        Atoms.flex_row,
        Atoms.items_center,
        Atoms.w_full,
        Atoms.py_sm,
        Atoms.px_sm,
        Atoms.gap_sm,
        Atoms.flex_wrap,
        style,
      ]}
      {...props}
    >
      <Pressable
        accessibilityLabel="Toggle color theme"
        accessibilityRole="button"
        hitSlop={8}
        onPress={toggleTheme}
        style={({ pressed }) => [pressed && { opacity: 0.65 }]}
      >
        <Icon
          name={theme.name === 'dark' ? 'themeLight' : 'themeDark'}
          size={typography.fontSize.sm}
          color="neutral_500"
        />
      </Pressable>
      {LINKS.map(({ text, href }) => (
        <FooterLink key={href} href={href} text={text} />
      ))}
    </View>
  );
}

type FooterLinkProps = {
  href: ExternalPathString;
  text: string;
};
function FooterLink({ href, text }: FooterLinkProps) {
  const { theme } = useTheme();
  return (
    <ExternalLink
      href={href}
      accessibilityLabel={text}
      style={theme.atoms.text_neutral_low}
    >
      {text}
    </ExternalLink>
  );
}

import { useWebHover } from '@/src/common/lib/useWebHover';
import { Atoms } from '@/src/common/theme';
import { type ExternalPathString, Link } from 'expo-router';
import type { ComponentProps } from 'react';

type LinkProps = ComponentProps<typeof Link>;

type ExternalLinkProps = Omit<
  LinkProps,
  'href' | 'onMouseEnter' | 'onMouseLeave'
> & {
  href: ExternalPathString;
};

/** Link to a URL outside the app; underlines on hover. */
export function ExternalLink({ style, children, ...props }: ExternalLinkProps) {
  const { hovered, onHoverIn, onHoverOut } = useWebHover();

  return (
    <Link
      accessibilityRole="link"
      onMouseEnter={(onHoverIn ?? undefined) as LinkProps['onMouseEnter']}
      onMouseLeave={(onHoverOut ?? undefined) as LinkProps['onMouseLeave']}
      style={[style, hovered && Atoms.text_underline]}
      {...props}
    >
      {children}
    </Link>
  );
}

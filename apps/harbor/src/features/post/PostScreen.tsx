import { Text } from '@/src/common/components';
import { Screen } from '@/src/common/components/layout';
import { APP_NAME } from '@/src/common/constants';
import { Atoms } from '@/src/common/theme';
import { usePageTitle } from '@/src/common/lib/navigation/usePageTitle';
import { truncateText } from '@/src/common/util/truncateText';
import { mentionsToPlainText } from '@/src/common/util/parseTextLinks';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { ThreadList } from '@/src/features/post/ThreadList';
import { usePostById } from '@/src/features/post/hooks/usePostById';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

export default function FeedPostScreen() {
  const {
    identityId,
    keyFingerprint,
    sequence = '',
  } = useLocalSearchParams<{
    identityId: string;
    keyFingerprint: string;
    sequence: string;
  }>();

  const { post, isLoading } = usePostById(
    identityId,
    keyFingerprint,
    BigInt(sequence),
  );

  const author = useProfile(post?.identity ?? null);
  usePageTitle(
    post && author.name
      ? `${author.name} on ${APP_NAME}: "${truncateText(mentionsToPlainText(post.content), 80)}"`
      : 'Post',
  );

  if (!post) {
    return (
      <Screen>
        <Screen.PrimaryColumn>
          <Screen.Topbar title="Post" />
          {isLoading ? null : (
            <View style={[Atoms.items_center, Atoms.py_3xl]}>
              <Text color="neutral_500">Post not found.</Text>
            </View>
          )}
        </Screen.PrimaryColumn>
      </Screen>
    );
  }

  return (
    <Screen>
      <Screen.PrimaryColumn>
        <View style={Atoms.flex_1}>
          <ThreadList
            post={post}
            HeaderComponent={<Screen.Topbar title="Post" />}
          />
        </View>
      </Screen.PrimaryColumn>
    </Screen>
  );
}

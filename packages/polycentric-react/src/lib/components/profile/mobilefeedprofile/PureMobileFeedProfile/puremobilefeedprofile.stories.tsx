import { PureMobileFeedProfile } from '.';

export default {
  title: 'Profile/PureMobileFeedProfile',
  component: PureMobileFeedProfile,
};

export const Default = {
  args: {
    profile: {
      name: 'John Doe',
      avatarURL: 'https://i.pravatar.cc/300',
      description: 'i like to repair. i like to repair. i like to repair. ',
      followerCount: 100,
      followingCount: 100,
    },
  },
};

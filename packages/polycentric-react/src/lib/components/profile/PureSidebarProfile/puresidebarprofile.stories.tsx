import { PureSidebarProfile } from '.'

export default {
  title: 'Profile/PureSidebarProfile',
  component: PureSidebarProfile,
}

export const Default = {
  args: {
    profile: {
      name: 'John Doe',
      avatarURL: 'https://i.pravatar.cc/300',
      description: 'i like to repair. i like to repair. i like to repair. ',
    },
  },
}

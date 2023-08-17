import { AccountSwitcher } from '.'

export default {
  title: 'Profile/AccountSwitcher',
  component: AccountSwitcher,
}

export const Default = {
  args: {
    currentProfile: {
      name: 'John Doe',
      avatarURL: 'https://i.pravatar.cc/300',
      description: 'i like to repair. i like to repair. i like to repair. ',
    },
  },
}

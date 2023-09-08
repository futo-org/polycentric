import { PopupComposeReply } from '.'

export default {
  title: 'Popup/PopupComposeReply',
  component: PopupComposeReply,
}

export const BasicRePost = {
  args: {
    main: {
      content: 'L + Ratio + 1',
      topic: '/tpot_dating',
      author: {
        name: 'John Doe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(),
    },
    sub: {
      content: 'This is the sub.content of the post',
      topic: '/tpot_dating',
      author: {
        name: 'John Foe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(new Date().getTime() - 5000),
      ContentLink: '#',
    },
  },
}

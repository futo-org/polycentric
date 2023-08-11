import React from 'react'
import { Modal } from '.'
import { PopupComposeReply } from '../../popup/PopupComposeReply'
import { PopupCompose } from '../../popup/PopupCompose'

export default {
  title: 'Util/Modal',
  component: Modal,
}

export const Default = {
  args: {
    open: true,
    title: 'test',
    children: 'Hello World',
  },
}

export const ReplyCompose = {
  args: {
    open: true,
    children: (
      <PopupComposeReply
        main={{
          content: 'L + Ratio + 1',
          topic: '/tpot_dating',
          author: {
            name: 'John Doe',
            avatarURL: 'https://i.pravatar.cc/300',
          },
          publishedAt: new Date(),
        }}
        sub={{
          content: 'This is the sub.content of the post',
          topic: '/tpot_dating',
          author: {
            name: 'John Foe',
            avatarURL: 'https://i.pravatar.cc/300',
          },
          publishedAt: new Date(new Date().getTime() - 5000),
        }}
      />
    ),
  },
}

export const Compose = {
  args: {
    open: true,
    children: <PopupCompose />,
  },
}

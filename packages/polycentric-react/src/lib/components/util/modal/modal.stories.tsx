import { Modal } from '.';
import { PopupCompose } from '../../popup/PopupCompose';
import { PopupComposeReply } from '../../popup/PopupComposeReply';
import { CropProfilePic } from '../../profile/CropProfilePic';

export default {
  title: 'Util/Modal',
  component: Modal,
};

export const Default = {
  args: {
    open: true,
    title: 'test',
    children: 'Hello World',
  },
};

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
        onComment={async () => false}
      />
    ),
  },
};

export const Compose = {
  args: {
    open: true,
    children: <PopupCompose onPost={async () => false} />,
  },
};

export const Crop = {
  args: {
    open: true,
    title: 'Crop',
    desktopClassName: 'w-[30rem]',
    children: (
      <CropProfilePic src="https://i.pravatar.cc/300" onCrop={() => 0} />
    ),
  },
};

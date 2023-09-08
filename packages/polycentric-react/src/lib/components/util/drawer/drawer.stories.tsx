import { Drawer } from '.'

export default {
  title: 'Util/Drawer',
  component: Drawer,
  argTypes: { setOpen: { action: 'clicked' } },
}

export const Default = {
  args: {
    open: true,
    side: 'left',
    title: 'Drawer Title',
  },
}

export const Right = {
  args: {
    open: true,
    side: 'right',
    title: 'Drawer Title',
  },
}

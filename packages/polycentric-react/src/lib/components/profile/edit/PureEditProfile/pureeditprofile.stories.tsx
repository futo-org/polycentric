import { PureEditProfile } from '.';
import { Profile } from '../../../../types/profile';

export default {
    title: 'Components/EditProfile',
    component: PureEditProfile,
};

const profile: Profile = {
    name: 'John Doe',
    avatarURL: 'https://i.pravatar.cc/300',
    description: 'i like to repair. i like to repair. i like to repair. ',
};

export const Default = {
    args: { profile, open: true },
};

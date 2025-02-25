import { Checkmark } from '.';

export default {
    title: 'Util/Checkbox',
    component: Checkmark,
};

export type VouchedByState = {
    avatar: string;
    username: string;
    link: string;
};

export const Default = {
    args: {
        vouchPeople: [
            {
                avatar: 'https://i.pravatar.cc/300',
                username: 'John Doe',
                link: 'https://i.pravatar.cc/300',
            },
            {
                avatar: 'https://i.pravatar.cc/300',
                username: 'John Guo',
                link: 'https://i.pravatar.cc/300',
            },
            {
                avatar: 'https://i.pravatar.cc/300',
                username: 'John Lo',
                link: 'https://i.pravatar.cc/300',
            },
        ],
    },
};

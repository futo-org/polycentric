import { SearchBox } from '.';

export default {
    title: 'Search/SearchBox',
    component: SearchBox,
};
export const Default = {
    args: {
        getResultsPreview: async (): Promise<{
            accounts: { name: string; avatarURL: string; handle: string }[];
            topics: string[];
        }> => {
            return {
                accounts: [
                    {
                        name: 'John Doe',
                        avatarURL: 'https://i.pravatar.cc/300',
                        handle: 'johndoe',
                    },
                    {
                        name: 'Jane Doe',
                        avatarURL: 'https://i.pravatar.cc/300',
                        handle: 'janedoe',
                    },
                ],
                topics: ['politics', 'news', 'programming'],
            };
        },
    },
};

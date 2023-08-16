import { SearchBox } from '.'

export default {
  title: 'Search/SearchBox',
  component: SearchBox,
}

export const Default = {
  args: {
    getResultsPreview: async (query: string): Promise<any> => {
      console.log(query)

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
      }
    },
  },
}

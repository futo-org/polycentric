import { TopicSuggestionBox } from '.';

export default {
  title: 'Feed/TopicSuggestionBox',
  component: TopicSuggestionBox,
};

const testTopics = {
  polycentric: {
    updates: {},
    developers: {},
  },
  popcornLovers: {
    butter: {},
    amcHaters: {},
  },
  tpot: {
    dating: {},
    technology: {},
  },
  eacc: {
    talk: {},
  },
  ebikes: {
    diy: {},
    ask: {},
    rides: {},
  },
  ee: {
    careers: {},
    ask: {},
    projects: {},
    news: {},
  },
  pakistan: {},
};

export const Default = {
  args: {
    query: '/polycentric',
    topics: testTopics,
  },
};
export const MultiMatch = {
  args: {
    query: '/p',
    topics: testTopics,
  },
};

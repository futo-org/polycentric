import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Overview',
      collapsed: false,
      items: ['intro', 'faq', 'servers', 'support'],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/posts',
        'features/feeds',
        'features/reactions',
        'features/following',
        'features/profiles',
        'features/search',
        'features/notifications',
        'features/verifications',
        'features/moderation',
        'features/identity',
      ],
    },
    {
      type: 'category',
      label: 'Polycentric Protocol',
      items: [
        'protocol/overview',
        'protocol/data-model',
        'protocol/grpc',
        'protocol/server-auth',
        'protocol/verifiers',
      ],
    },
    {
      type: 'category',
      label: 'Developer',
      items: [
        'developer/setup',
        'developer/project-structure',
        'developer/feed-paging',
        'developer/declaring-your-application',
        'developer/e2e-testing',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/running-a-server',
        'guides/self-hosting-a-verifier',
        'guides/add-a-platform-verifier',
        'guides/setting-up-an-alias',
      ],
    },
    'privacy-policy',
  ],
};

export default sidebars;

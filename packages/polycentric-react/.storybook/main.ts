import type { StorybookConfig } from '@storybook/react-vite';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);

function getAbsolutePath(value: string): string {
    return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
    stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],

    addons: [
        getAbsolutePath('@storybook/addon-a11y'),
        getAbsolutePath('@storybook/addon-links'),
        getAbsolutePath('@storybook/addon-essentials'),
        getAbsolutePath('@storybook/addon-interactions'),
        getAbsolutePath('@storybook/addon-styling-webpack'),
    ],

    framework: {
        name: getAbsolutePath('@storybook/react-vite'),
        options: {
            builder: {
                viteConfigPath: '.storybook/vite.config.ts',
            },
        },
    },

    docs: {
        autodocs: 'tag',
    },

    typescript: {
        reactDocgen: 'react-docgen-typescript'
    }
};

export default config;

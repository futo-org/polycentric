module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    extends: [
        'plugin:@typescript-eslint/strict-type-checked',
        'plugin:@typescript-eslint/stylistic-type-checked',
    ],
    overrides: [],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
    },
    plugins: ['jest'],
    rules: {
        '@typescript-eslint/no-namespace': 'off',
    },
    settings: {},
};

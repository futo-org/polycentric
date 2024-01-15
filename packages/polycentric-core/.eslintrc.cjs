module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'plugin:@typescript-eslint/recommended',
  ],
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['react', 'react-refresh', 'jest'],
  rules: {
    "@typescript-eslint/no-namespace": "off"
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
}

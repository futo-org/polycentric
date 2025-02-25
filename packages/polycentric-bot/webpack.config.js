const path = require('path');
const Dotenv = require('dotenv-webpack');

module.exports = {
  entry: './src/index.ts',
  target: 'node',
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  externals: {
    'classic-level': "require('classic-level')",
  },
  plugins: [
    new Dotenv({
      // use .env.development file instead of .env in development (webpack --mode=development)
      path:
        process.env.NODE_ENV === 'development'
          ? './.env.development'
          : './.env',
    }),
  ],
};

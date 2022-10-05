const path = require('path');

const nodeConfig = {
    entry: './src/index.ts',
    target: 'node',
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'node.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs'
    },
};

const browserConfig = {
    entry: './src/index.ts',
    target: 'web',
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'browser.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs'
    },
};

module.exports = [ browserConfig, nodeConfig ];

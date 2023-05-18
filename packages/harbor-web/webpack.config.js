const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");

const mainConfig = {
    entry: './src/index.tsx',
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                use: 'ts-loader',
                exclude: /node_modules/
            },
            {
                test: /\.css$/i,
                use: [
                    'style-loader',
                    'css-loader',
                    'postcss-loader'
                ]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif)$/i,
                type: 'asset/resource'
            },
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/i,
                type: 'asset/resource'
            }
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs'
    },
    plugins: [
        new CopyPlugin({ patterns: [{ from: 'public' }] })
    ],
    devServer: {
        static: {
            directory: path.join(__dirname, 'public'),
        },
        historyApiFallback: true,
        compress: false,
        port: 3001,
        https: true,
        client: {
            overlay: true,
            progress: true,
            reconnect: true
        }
    },
};

module.exports = [mainConfig];

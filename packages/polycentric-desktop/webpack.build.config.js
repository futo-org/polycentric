const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Any directories you will be adding code/files into, need to be added to this array so webpack will pick them up
const defaultInclude = path.resolve(__dirname, 'src');
const polycentricInclude = path.resolve(__dirname, '../polycentric-react/dist');
const fontSourceInclude1 = path.resolve(
    __dirname,
    '../../node_modules/@fontsource',
);
const fontSourceInclude2 = path.resolve(__dirname, 'node_modules/@fontsource');

module.exports = {
    externals: {
        'classic-level': "require('classic-level')",
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [MiniCssExtractPlugin.loader, 'css-loader'],
                include: [
                    defaultInclude,
                    polycentricInclude,
                    fontSourceInclude1,
                    fontSourceInclude2,
                ],
            },
            {
                test: /\.jsx?$/,
                use: [{ loader: 'babel-loader' }],
                include: defaultInclude,
            },
            {
                test: /\.(jpe?g|png|gif|svg|ico)$/,
                use: [
                    {
                        loader: 'file-loader?name=img/[name]__[hash:base64:5].[ext]',
                    },
                ],
                include: [defaultInclude, polycentricInclude],
            },
            {
                test: /\.(eot|ttf|woff|woff2)$/,
                use: [
                    {
                        loader: 'file-loader?name=font/[name]__[hash:base64:5].[ext]',
                    },
                ],
                include: [defaultInclude, polycentricInclude],
            },
        ],
    },
    target: 'electron-renderer',
    plugins: [
        new HtmlWebpackPlugin({
            title: 'Polycentric',
        }),
        new MiniCssExtractPlugin({
            // Options similar to the same options in webpackOptions.output
            // both options are optional
            filename: 'bundle.css',
            chunkFilename: '[id].css',
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('production'),
        }),
        // new MinifyPlugin()
    ],
    stats: {
        colors: true,
        children: false,
        chunks: false,
        modules: false,
    },
    optimization: {
        minimize: true,
    },
};

import * as Core from 'polycentric-react';
import express, { Express, Request, Response } from 'express';

import * as AbstractLevel from 'abstract-level';
import * as ClassicLevel from 'classic-level';

const level = new ClassicLevel.ClassicLevel<Uint8Array, Uint8Array>(
    './polycentric.leveldb',
    {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
    },
) as any as AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>;

Core.createApp(level);

const app: Express = express();

const port = 2000;

app.get('/', (req: Request, res: Response) => {
    res.send('Express + TypeScript Server');
});

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at https://localhost:${port}`);
});

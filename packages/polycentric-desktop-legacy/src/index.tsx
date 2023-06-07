import express, { Express, Request, Response } from 'express';
import * as Path from 'path';

import * as PolycentricReact from '@polycentric/polycentric-react';
import * as PolycentricLevelDB from '@polycentric/polycentric-leveldb';

async function main() {
    PolycentricReact.createApp(
        PolycentricLevelDB.createPersistenceDriverLevelDB('./'),
    );
}

main();

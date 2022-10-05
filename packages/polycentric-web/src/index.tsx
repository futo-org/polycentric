import * as AbstractLevel from 'abstract-level';
import * as BrowserLevel from 'browser-level';
import * as MemoryLevel from 'memory-level';

import * as Core from 'polycentric-react';

let level = new BrowserLevel.BrowserLevel<Uint8Array, Uint8Array>(
    'PolycentricStateV5',
    {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
    },
) as AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>;

async function main() {
    try {
        await level.open();
    } catch (err) {
        alert('Failed to open IndexedDB. Using in memory fallback.');

        level = new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>;
    }
    Core.createApp(level);
}

main();

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

const registerServiceWorker = async () => {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("/worker.js", {
        scope: "/",
      });
      if (registration.installing) {
        console.log("Service worker installing");
      } else if (registration.waiting) {
        console.log("Service worker installed");
      } else if (registration.active) {
        console.log("Service worker active");
      }
    } catch (error) {
      console.error(`Registration failed with ${error}`);
    }
  }
};

async function main() {
    await registerServiceWorker();

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

import * as PolycentricReact from 'polycentric-react';

const cacheKey = 'polycentric-cache';

declare const self: ServiceWorkerGlobalScope;

function isSameOrigin(url: string): boolean {
    return ((new URL(url)).origin) === self.location.origin;
}

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    self.clients.claim();
});

self.addEventListener("fetch", (event: FetchEvent) => {
    event.respondWith((async () => {
        if (isSameOrigin(event.request.url) === true) {
            const cache = await caches.open(cacheKey);

            try {
                const response = await fetch(event.request);

                cache.put(event.request, response.clone());

                return response;
            } catch {
                const cached = await cache.match(event.request.url);

                if (cached === undefined) {
                    return new Response(new Blob(), {
                        status: 404,
                    });
                } else {
                    return cached;
                }
            };
        } else {
             return fetch(event.request);
        }
    })());
});

export {};

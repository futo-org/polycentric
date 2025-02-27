In the monorepo, so you can just @ it in whatever editor you're using.

If we want to cache precomputed view queries, like getting all comments for a topic
(grayjay video), we want to be able to invalidate the route any time someone either
deletes a comment or adds a new one. Cloudflare only gives you 30k requests a day,
so that's off the table here.

Instead, we can roll our own caching solution almost identically to Cloudflare.

There are four scenarios we handle in cache invalidation:

1. Invalidating a property of a user, for example, a user's username. For this case,
   we store a tag pkey-{content_type}-{pkey} for the user's pkey.
2. Invalidating an event in the case of deletion. For this case, we store a tag
   pointer-{pointer} for the event.
3. Invalidating a reference. This is very important for making sure comments are
   up to date. Currently, this invalidates all pages of requests for a reference;
   in the future, it can be made more efficient. This is dona as ref-{reference}.
4. Invalidating a user's metadata (range requests, head requests, etc). This is
   done as pkey-meta-{pkey}.

Cache tags are generated on both ingestion and request of an event. On ingestion,
we generate cache tags for an event and purge them from the cache. On request,
we generate whichever subset of the tags that request would need to be invalidated on.

We cache on the response level instead of the database query level because it makes
implementation of invalidation much simpler, and thus, more understandable and
maintainable.

We use Caddy as our Cache - this is mostly because it has a good implementation powered
by [Souin](https://github.com/darkweak/souin) and is very easy to configure. Souin is
a Go library that is used to cache responses from servers. It has a 
[Caddy plugin](https://github.com/caddyserver/cache-handler) that we can use to invalidate 
cache tags.

We use the `Surrogate-Key` header to purge cache tags. It works almost identically to
Cloudflare's Cache Tagging, just a different name.

The cache invalidation system is extremely configurable and can support different 
caches if so desired. A cloudflare plugin is extremely easy to write if rate limits
ever 100x, but doing so is left as an exercise to the reader.

Feel free to reconfigure Souin as you like, it's in the `Caddyfile`. It supports a 
disk cache as well as an in-memory cache, along many different backends, but is
currently configured to use a 1gb memory cache.
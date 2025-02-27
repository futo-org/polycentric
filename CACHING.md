In the monorepo, so you can just @ it in whatever editor you're using.

We want to cache precomputed view queries. For example, when getting all comments for 
a topic (grayjay video), we want to be able to invalidate the /query_references route 
for that reference any time someone either deletes a comment or adds a new one. We also 
want to do this for any other query - like checking vouches, getting a user's process 
metadata, etc. 

To do this, we can attach cache tags to every server response, and when we 
recieve a new event, generate cache tags for the new event and see if it overlaps with
any existing cache tags in responses. If it does, we purge the response cache for those tags.

For example, for every query references request, we generate a cache tag references-{reference}.
When we recieve a new event, we auto-generate a tag for it called reference-{reference} since
it will invalidate any requests that use that reference. If the new event has a reference that matches
any existing cache tags, we purge the response cache for those tags. 

Another example is when we recieve a delete event for a comment. We generate a cache tag pointer-{pointer}
for the event, and if a deletion event comes in, we purge the response cache for that tag. For things
like usernames, similar logic - we generate a tag pkey:{content_type}:{pkey} for the event, and if a
new event comes in that matches this pattern (event that uses a content type and pkey), 
we purge the response cache for that tag.

There are four scenarios we handle in cache invalidation:

1. Invalidating a property of a user, for example, a user's username. For this case,
   we generate a tag pkey-{content_type}-{pkey} for user-related events,
   and on ingestion of a new event that matches this pattern, we purge the
   cache for that tag. This way, we can invalidate the user's username without
   invalidating the entire user.
2. Invalidating an event in the case of deletion. For this case, we store a tag
   pointer-{pointer} for the event. If a deletion event comes in, we purge the
   cache for any path that includes a reference to that event.
3. Invalidating a reference. This is very important for making sure comments are
   up to date. Currently, this invalidates all pages of requests for a reference;
   in the future, it can be made more efficient. This is dona as ref-{reference}.
4. Invalidating a user's metadata (range requests, head requests, etc). This is
   done as pkey-meta-{pkey}.

We cache on the response level instead of the database query level because it makes
implementation of invalidation much simpler, and thus, more understandable and
maintainable.

Cloudflare only gives us purge 30k requests a day, so that's off the table here
already with current usage. Instead, we can roll our own caching solution almost 
identically to Cloudflare.

We use Varnish as our Cache - this is mostly because it has a good implementation powered
by xkey and is very easy to configure. xkey is a Varnish module that is used to cache responses 
from servers.  It works almost identically to Cloudflare's Cache Tagging, just a different name
and header. It's included in the docker image, so no extra steps are needed to enable it.

The cache invalidation system is extremely configurable and can support different 
caches if so desired. A cloudflare plugin is extremely easy to write if rate limits
ever 100x, but doing so is left as an exercise to the reader.

With this, we can turn off cloudflare caching altogether, and just use Varnish. Varnish
can be configured to use a disk cache as well as an in-memory cache, along many different
backends, but is currently configured to use a 1gb memory cache. It can also be configured
to scale horizontally, but this is not currently configured.
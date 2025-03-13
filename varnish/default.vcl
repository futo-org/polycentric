vcl 4.1;

import xkey;

# Backend definition
backend default {
    .host = "server";
    .port = "8081";
}

sub vcl_recv {
    # Handle purging with xkey
    if (req.method == "PURGE") {
        # Allow purge requests only from localhost
        #if (client.ip != "127.0.0.1" && client.ip != "::1") {
        #    return (synth(403, "Forbidden"));
        #}
        
        # Check for xkey header for surrogate key purging
        if (req.http.xkey) {
            set req.http.n-gone = xkey.purge(req.http.xkey);
            return (synth(200, "Purged " + req.http.n-gone + " objects"));
        } else {
            return (synth(403, "Heho"));
        }
    }

    # Standard cache control handling
    if (req.method == "GET" || req.method == "HEAD") {
        # Cache the request by default
        return (hash);
    }
    
    # Pass non-GET/HEAD requests
    return (pass);
}

sub vcl_backend_response {
    # Set default TTL to 5 minutes if not specified
    if (beresp.ttl <= 0s) {
        set beresp.ttl = 0s;
        set beresp.uncacheable = true;
    } else if (beresp.http.surrogate-key) {
        set beresp.http.xkey = beresp.http.surrogate-key;
    }
    
    return (deliver);
}

sub vcl_deliver {
    # Remove the internal headers before delivering to client
    unset resp.http.xkey;
    unset resp.http.surrogate-key;
    
    # Add a header to indicate cache hit/miss
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
    
    return (deliver);
}
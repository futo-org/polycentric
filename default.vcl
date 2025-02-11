vcl 4.0;

acl purge {
    "localhost";
}

backend default {
    .host = "development";
    .port = "8081";
}

sub vcl_recv {
    if (req.method == "PURGE") {
        if (!client.ip ~ purge) {
            return (synth(405, "Not allowed."));
        }
        return (purge);
    }
} 
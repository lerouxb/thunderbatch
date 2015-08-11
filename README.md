# thunderbatch

Request middleware that batches together identical requests to get around the thundering herd problem.

## How it works

This is middleware intended to be used with request-extensible and in conjunction with http-request-cache.

If a URL isn't coming straight out of the cache (either because it isn't cached yet or because it just expired) and it is a "busy URL", then it is possible for multiple identical requests to go out to the same URL "at the same time", meaning they will all be started before the first one finished and write to the cache.

If you're sending the etag (which http-request-cache does), then there's a good chance that the request would have responded with "Not Modified" and it doesn't count against your rate limit. If you didn't or it changed, then each of those concurrent requests will count against your rate limit.

What ThunderBatch does, is it uses Redis as a sort of distributed lock where the first request will get the lock and subsequent ones won't. Unlike the usual ways of using locks they won't block or retry. Not getting that lock is not an error, but a sign that you're saving on outgoing requests!

All requests for a specific URL will subcribe to a channel on redis for that URL.

The first request (the one that won and got the lock) will do the actual request and once it is done it will publish a message via redis to a channel just for that URL and then all the requests suscribing to that channel including the one that actually performed the request will get the response, unsubscribe from that channel and send the result back down the request middleware chain.


## Demo

Start redis-server in a terminal, then in another:

    npm install express request-extensible
    cd example
    export DEBUG=thunderbatch
    node gitproxycluster.js

Here's an example URL to visit:
<http://localhost:8080/users/lerouxb/subscriptions>

Testing this gets tricky. Open the URL in a bunch of browser windows or terminals or run it in a benchmarking utility..



var crypto = require('crypto');
var redis = require('redis');
var Promise = require('bluebird');
var debug = require('debug')('thunderbatch');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

// just copied from request-http-cache
function hashKeyString(s) {
  var shasum = crypto.createHash('sha1');
  shasum.update(s);
  return shasum.digest('hex');
}

// I'm so ready for es6...
var deleteKeyScript = ''+
  'if redis.call("get",KEYS[1]) == ARGV[1] then\n'+
  '  return redis.call("del",KEYS[1])\n'+
  'else\n'+
  '  return 0\n'+
  'end';

function ThunderBatch(options) {
  if (!options) options = {};
  this.redis = options.redis || {};
  this.client = this.makeClient();
  this.extension = this.extensionMethod.bind(this);
}

util.inherits(ThunderBatch, EventEmitter);

ThunderBatch.prototype.makeClient = function() {
  var redisPort = this.redis.port || 6379;
  var redisHost = this.redis.host || '127.0.0.1';
  var redisOptions = this.redis.options || {};
  var client = redis.createClient(redisPort, redisHost, redisOptions);
  return Promise.promisifyAll(client);
};

ThunderBatch.prototype.extensionMethod = function(options, callback, next) {
  if (options.method == 'GET' && options.uri) {
    this.intercept(options, callback, next);
  } else {
    this.passthrough(options, callback, next);
  }
};

ThunderBatch.prototype.passthrough = function(options, callback, next) {
  next(options, callback);
};

ThunderBatch.prototype.intercept = function(options, callback, next) {
  // Only respond once
  var responded = false;

  // the request timeout will also be used on the redis "lock"
  var timeout = options.timeout || 30000;

  var timeoutId;

  function respond(err, response, body) {
    clearTimeout(timeoutId);
    if (responded) {
      debug('We have already responded!');
    } else {
      responded = true;
      callback(err, response, body);
    }
  }

  // This middleware will execute before the real request, so we should
  // probably handle our own timeouts. The reason is that this could be a redis
  // problem and might therefore have nothing to do with http connection or
  // read timeouts. Basically: The subscriber never got the message event.
  timeoutId = setTimeout(function() {
    debug("Timeout while waiting for published Redis message.");
    var err = new Error('PUBSUBTIMEDOUT')
    err.code = 'PUBSUBTIMEDOUT'
    respond(err);
  }, timeout);

  var client = this.client;
  var subscriber = this.makeClient();
  var emit = this.emit.bind(this);

  // This cache key should probably work in a similar way to
  // request-http-cache's cache keys, but this works for now.
  var key = 'http:'+hashKeyString(options.uri);

  // Regardless of what happens, we subscribe to the URL. Once the first
  // message comes in we send that back as the response. We're relying on the
  // request timing out as usual if things go haywire.
  subscriber.on('message', function (channel, messageString) {
    subscriber.unsubscribe(key);
    subscriber.quit();

    // I am not sure how to reconstruct these vars out of message yet. I'm
    // thinking err might not necessarily be jsonable. This seems to work for
    // valid requests, though :)
    var message = JSON.parse(messageString);
    var err = message.err;
    var response = message.response;
    var body = message.body;

    // The only place where the response gets passed back up the middleware
    // chain. (Both for first requests and subsequent ones.)
    respond(err, response, body);
  });
  subscriber.subscribe(key);

  // Now we try and see if we're the first request (as in the only one in
  // progress so far) for this URL by getting a "lock" of sorts. I stole this
  // pattern from http://redis.io/topics/distlock but I don't want something
  // that will retry or block or whatever because NOT getting the lock is
  // actually normal behavior here.
  var randomValue = Math.random();
  client.setAsync(key, randomValue, 'NX', 'PX', timeout)
    .then(function(response) {
      if (response == 'OK') {
        debug('requesting '+options.uri);
        emit('request', options.uri);
        // this is the first one, so we should actually make the request
        // (ie continue down the middleware chain)
        next(options, function (err, response, body) {
          // not sure how to serialise these parameters yet
          var message = {
            err: err,
            response: response,
            body: body
          };
          var messageString = JSON.stringify(message);

          // The lua script could be loaded first, making it faster (probably)
          // This also isn't transaction-safe, but I'm deliberately publishing
          // AFTER releasing the lock so that if something thinks it is locked
          // they will get this response. Otherwise there's a gap in between,
          // potentially causing hard to find bugs. This could probably be
          // rolled into the script too..
          client
            .evalAsync(deleteKeyScript, 1, key, randomValue)
            .then(function publishTheMessage() {
              return client.publishAsync(key, messageString);
            })
            .catch(function(err) {
              // this request will get an error, the others will time out
              respond(err);
            });
        });
      } else {
        debug('saving a request for '+options.uri);
        emit('saved', options.uri);
      }
    }).catch(function(err) {
      respond(err);
    });
};

ThunderBatch.prototype.quit = function() {
  this.client.quit();
};

module.exports = ThunderBatch;

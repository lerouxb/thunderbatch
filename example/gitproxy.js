'use strict'; // ugh.

var express = require('express');
var requestExt = require('request-extensible');
//var RequestHttpCache = require('request-http-cache');
var redis = require('redis');
var ThunderBatch = require('../lib');

// Commenting out RequestHttpCache for now because the efficient caching makes
// it too difficult to test manually, but I'm leaving it in here for
// documentation purposes.

/*
var httpRequestCache = new RequestHttpCache({
  backend: 'redis',
  ttl: 86400
});
*/
var redis = redis.createClient();

var thunderBatch = new ThunderBatch();
thunderBatch.on('saved', function(url) {
  redis.incr('requests-saved');
});

var request = requestExt({
  extensions: [
    function(options, callback, next) {
      if (options.uri == 'https://api.github.com/favicon.ico') {
        return callback(null, {statusCode: 404});
      }
      next(options, function (err, response, body) {
        callback(err, response, body);
      });
    },
    //httpRequestCache.extension,
    thunderBatch.extension
  ]
});

var app = express();

app.set('json spaces', 2);

app.get('/*', function(req, res, next) {
  var headers = {
    'User-Agent': 'ThunderBatch',
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }

  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers['Authorization'] = 'token '+process.env.GITHUB_ACCESS_TOKEN;
  }

  var options = {
    method: 'GET',
    uri: 'https://api.github.com' + req.path,
    headers: headers
  };

  request(options, function(err, response, body) {
    if (err) return next(err);

    // this is all silly, but just for demonstration purposes anyway
    if (response.headers) res.set(response.headers);
    res.status(response.statusCode);
    if (response.headers['content-type'].indexOf('application/json') == 0) {
      var json = JSON.parse(body);
      res.send(json);
    } else {
      res.send(body);
    }
  });
});

console.log('listening on http://localhost:8080')
app.listen(8080);

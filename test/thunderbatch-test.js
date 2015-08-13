var async = require('async');
var assert = require('assert');
var sinon = require('sinon');
var ThunderBatch = require('..');

// The actual URL is irrelevant, because we're never going to actually make a
// real request.
var URL = 'http://localhost:9999/test';

function fakeWorkingRequest(options, callback) {
  setTimeout(function() {
    var err = null;
    var response = {statusCode: 200};
    var body = 'OK';
    callback(err, response, body);
  }, 0);
}

function fakeErrorRequest(options, callback) {
  setTimeout(function() {
    var err = new Error("Something went wrong.");
    err.code = "FAKE"
    callback(err);
  }, 0);
}

function fakeTimeoutRequest(options, callback) {
}

describe('ThunderBatch', function() {
  var thunderBatch, workingSpy, errorSpy, timeoutSpy;

  var getOptions = {
    method: 'GET',
    uri: URL,
    timeout: 50
  };

  var postOptions = {
    method: 'POST',
    uri: URL,
    timeout: 50
  };

  beforeEach(function() {
    thunderBatch = new ThunderBatch();

    sinon.spy(thunderBatch, 'passthrough');
    sinon.spy(thunderBatch, 'intercept');

    workingSpy = sinon.spy(fakeWorkingRequest);
    errorSpy = sinon.spy(fakeErrorRequest);
    timeoutSpy = sinon.spy(fakeTimeoutRequest);
  });

  afterEach(function() {
    thunderBatch.quit();
  });

  // --

  it('should intercept GET requests', function(done) {
    thunderBatch.extension(getOptions, function(err, response, body) {
      assert.equal(true, thunderBatch.intercept.calledOnce);
      assert.equal(false, thunderBatch.passthrough.called);
      done();
    }, workingSpy);
  });

  it('should pass non-GET requests', function(done) {
    thunderBatch.extension(postOptions, function(err, response, body) {
      assert.equal(false, thunderBatch.intercept.calledOnce);
      assert.equal(true, thunderBatch.passthrough.called);
      done();
    }, workingSpy);
  });

  var multipleRequests = [
    function(cb) {
      thunderBatch.extension(getOptions, cb, workingSpy);
    },
    function(cb) {
      thunderBatch.extension(getOptions, cb, workingSpy);
    }
  ];

  it('should make one concurrent identical request', function(done) {
    async.parallel(multipleRequests, function(err) {
      assert(!err);
      assert(workingSpy.calledOnce);
      done();
    });
  });

  it('should make multiple consecutive identical requests', function(done) {
    async.series(multipleRequests, function(err) {
      assert(!err);
      assert(workingSpy.calledTwice);
      done();
    });
  });

  it('should handle backend errors', function(done) {
    thunderBatch.extension(getOptions, function(err, response, body) {
      assert.equal(err.code, 'FAKE');
      assert(!response);
      assert(!body);
      done();
    }, errorSpy);
  });

  it('should timeout properly', function(done) {
    thunderBatch.extension(getOptions, function(err, response, body) {
      assert.equal(err.code, 'PUBSUBTIMEDOUT');
      assert(!response);
      assert(!body);
      done();
    }, timeoutSpy);
  });
});

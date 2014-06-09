var fs = require('fs'),
    crypto = require('crypto'),
    Microee = require('microee'),
    parallel = require('miniq');

// calculates and caches hashes for a file
function Hash(filename, size) {
  this.filename = filename;
  this.size = size;
  // largest power of two, minus 12 (2^12 = 4k)
  this.maxIndex = Math.floor(Math.log(size) / Math.LN2) - 10;
  this.hashes = [];
  this.fd = null;
  // if concurrent requests are made to the same path + index,
  // do not duplicate requests, but rather queue them
  this.emitter = new Microee();
  this.pending = [];
  this.lastBytes = 0;
}

Hash.prototype._params = function(index) {
 // first size is 2k
  var offset = (index === 0 ? 0 : Math.pow(2, 10 + index)),
      limit = Math.pow(2, 10 + index + 1);

  // smaller of file size and value
  offset = Math.min(this.size, offset);
  limit = Math.min(this.size, limit);

  return [ offset, limit ];
};

Hash.prototype.get = function(index, onDone) {
  // zero-length files cannot be read, skip
  if (this.size === 0) {
    this.lastBytes = 0;
    return onDone(null, false);
  }
  if (this.hashes[index]) {
    this.lastBytes = 0;
    return onDone(null, this.hashes[index]);
  }

  var self = this,
      opts = this._params(index),
      offset = opts[0],
      limit = opts[1],
      totalPending = limit - offset,
      bsize = Math.min(totalPending, 64 * 1024),
      totalRead = 0;

  // prevent duplicate pending reads
  if (this.pending.indexOf(index) > -1) {
    this.emitter.once('calculate:' + index, onDone);
    return;
  }
  this.pending.push(index);

  // each index calculation gets its own hash and buffer instances
  var hash = crypto.createHash('md5'),
      readBuffer = new Buffer(bsize);

  function read(complete) {
    fs.read(self.fd, readBuffer, 0, readBuffer.length, offset + totalRead, function(err, bytesRead) {
      totalRead += bytesRead;
      if (err) {
        throw err;
      }
      // update hash
      try {
        hash.update(bytesRead == readBuffer.length ? readBuffer : readBuffer.slice(0, bytesRead));
      } catch (err) {
        throw err;
      }
      if (totalRead == totalPending) {
        return complete();
      }
      read(complete);
    });
  }

  parallel(1, [
    function(done) {
      if (self.fd) {
        return done();
      }
      fs.open(self.filename, 'r', function(err, fd) {
        if (err) { throw err; }
        self.fd = fd;
        done();
      });
    },
    function(done) {
      read(function() {
        self.hashes[index] = hash.digest('base64');
        hash = null;
        readBuffer = null;

        self.pending = self.pending.filter(function(value) {
          return value != index;
        });
        self.lastBytes = totalRead;
        onDone(null, self.hashes[index]);
        self.emitter.emit('calculate:' + index, null, self.hashes[index]);
        done();
      });
    }
  ]);

};

Hash.prototype.getSync = function(index) {
  // zero-length files cannot be read, skip
  if (this.size === 0) {
    this.lastBytes = 0;
    return false;
  }
  if (this.hashes[index]) {
    this.lastBytes = 0;
    return this.hashes[index];
  }
  var self = this,
      opts = this._params(index),
      offset = opts[0],
      limit = opts[1],
      totalPending = limit - offset,
      bsize = Math.min(totalPending, 64 * 1024),
      totalRead = 0;

  // each index calculation gets its own hash and buffer instances
  var hash = crypto.createHash('md5'),
      readBuffer = new Buffer(bsize),
      bytesRead = 0;

  if(!self.fd) {
    self.fd = fs.openSync(this.filename, 'r');
  }

  while (totalRead < totalPending) {
    bytesRead = fs.readSync(self.fd, readBuffer, 0, readBuffer.length, offset + totalRead);
    totalRead += bytesRead;

    try {
      hash.update(bytesRead == readBuffer.length ? readBuffer : readBuffer.slice(0, bytesRead));
    } catch (err) {
      throw err;
    }
  }

  self.hashes[index] = hash.digest('base64');
  hash = null;
  readBuffer = null;
  this.lastBytes = totalRead;

  return self.hashes[index];
};

// call this to close the underlying fds
Hash.prototype.close = function(onDone) {
  if (this.fd) {
    if (onDone) {
      fs.close(this.fd, onDone);
    } else {
      fs.closeSync(this.fd);
    }
    this.fd = null;
  } else if(onDone) {
    onDone();
  }
};

module.exports = Hash;

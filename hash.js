var fs = require('fs'),
    crypto = require('crypto'),
    Microee = require('microee');

// calculates and caches hashes for a file
function Hash(filename, size) {
  this.filename = filename;
  this.size = size;
  // largest power of two, minus 12 (2^12 = 4k)
  this.maxIndex = Math.floor(Math.log(size) / Math.LN2) - 10;
  this.hashes = [];
  this.hash = null;
  this.fd = null;
  this.buffer = null;
  // if concurrent requests are made to the same path + index,
  // do not duplicate requests, but rather queue them
  this.emitter = new Microee();
  this.pending = [];
}

Hash.prototype.get = function(index, onDone) {
  var self = this;
  // zero-length files cannot be read, skip
  if (this.size === 0) {
    return onDone(null, false, 0);
  }
  if (this.hashes[index]) {
    return onDone(null, this.hashes[index], 0);
  }

  // console.log('GET', self.filename, index);

  // prevent duplicate pending reads
  if (this.pending.indexOf(index) > -1) {
    this.emitter.once('calculate:' + index, onDone);
    return;
  }
  this.pending.push(index);

  // first size is 2k
  var offset = (index === 0 ? 0 : Math.pow(2, 10 + index)),
      limit = Math.pow(2, 10 + index + 1);

  // smaller of file size and value
  offset = Math.min(this.size, offset);
  limit = Math.min(this.size, limit);

  if (this.fd !== null) {
    return this.calculate(this.fd, offset, limit, index, onDone);
  }
  fs.open(this.filename, 'r', function(err, fd) {
    if (err) {
      return onDone(err, false, 0);
    }
    self.fd = fd;
    self.calculate(fd, offset, limit, index, onDone);
  });
};

Hash.prototype.calculate = function(fd, offset, limit, index, onDone) {
  var self = this,
      totalPending = limit - offset,
      totalRead = 0;

  var bsize = Math.min(totalPending, 64 * 1024);

  // each index calculation gets its own hash and buffer instances
  var hash =  crypto.createHash('md5');
  var readBuffer = new Buffer(bsize);

  // perform reads 32k at a time; push directly into the hashing algorithm so the buffer
  // can be discarded
  function read() {
    // console.log('READ', self.filename, 0, readBuffer.length, self.size, offset, offset + totalRead);
    fs.read(fd, readBuffer, 0, readBuffer.length, offset + totalRead, function(err, bytesRead, buffer) {
      totalRead += bytesRead;
      if (err) {
        return onDone(err, false, 0);
      }
      try {
        hash.update(buffer.slice(0, bytesRead));
      } catch (err) {
        console.error('Hash.update failed for ' + self.filename + '.', {
          offset: offset,
          totalRead: totalRead,
          bytesRead: bytesRead,
          totalPending: totalPending,
          buffer: buffer.slice(0, bytesRead).toString(),
          hash: hash });
        throw err;
      }
      if (totalRead == totalPending) {
        // console.log('Hash.digest for ' + self.filename, totalRead, totalPending);
        self.hashes[index] = hash.digest('base64');
        hash = null;
        readBuffer = null;

        self.pending = self.pending.filter(function(value) {
          return value != index;
        });
        onDone(null, self.hashes[index], totalRead);
        self.emitter.emit('calculate:' + index, null, self.hashes[index], totalRead);
        return;
      } else {
        process.nextTick(function() {
          read();
        });
      }
    });
  }

  read();
};

// call this to close the underlying fds
Hash.prototype.close = function() {
  if (this.fd) {
    fs.close(this.fd);
    this.fd = null;
  }
  if (this.buffer) {
    this.buffer = null;
  }
};

module.exports = Hash;

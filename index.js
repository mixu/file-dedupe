var fs = require('fs'),
    path = require('path'),
    Hash = require('./hash.js'),
    parallel = require('miniq');

function Dedupe() {
  this.byInode = {};
  this.bySize = {};
  this.sizeByName = {};
  this.hashByName = {};
  this.bytesRead = 0;
  this.statCalls = 0;
}

Dedupe.prototype.find = function(filename, stat, onDone) {
  var self = this;
  filename = path.normalize(filename);

  if (arguments.length === 2) {
    onDone = stat;
    stat = null;
  }

  if (!stat) {
    this.statCalls++;
    fs.stat(filename, function(err, stat) {
      if (err) {
        console.error('fs.stat failed for ' + filename + '.', err);
        return onDone(err, false, null);
      }
      self._check(filename, stat, onDone);
    });
  } else {
    this._check(filename, stat, onDone);
  }
};

Dedupe.prototype._check = function(filename, stat, onDone) {
  var self = this;
  if (!stat.isFile() || stat.size === 0) {
    return onDone(null, false, stat);
  }

  self.sizeByName[filename] = stat.size;

  if (stat.ino !== 0 && self.byInode[stat.ino]) {
    self.byInode[stat.inode] = filename;
    return onDone(null, self.byInode[stat.ino], stat);
  }
  if (stat.ino !== 0) {
    self.byInode[stat.inode] = filename;
  }

  // push before starting the comparison; this allows _findBySize to be async and yet
  // pick up the candidate match
  if (!self.bySize[stat.size]) {
    self.bySize[stat.size] = [ filename ];
  } else if (self.bySize[stat.size].indexOf(filename) === -1){
    self.bySize[stat.size].push(filename);
  }
  self._findBySize(filename, stat, onDone);
};

Dedupe.prototype._findBySize = function(filename, stat, onDone) {
  var self = this,
      result = false;
  // only this file
  if (this.bySize[stat.size].length === 1) {
    return onDone(null, false, stat);
  }

  if (!self.hashByName[filename]) {
    self.hashByName[filename] = new Hash(filename, stat.size);
  }

  parallel(1, this.bySize[stat.size].map(function(comparename) {
    return function(done) {
      // skip if the file name is the same, or if the result has already been resolved at this point
      if (comparename === filename || result) {
        return done();
      }

      if (!self.hashByName[comparename]) {
        self.hashByName[comparename] = new Hash(comparename, self.sizeByName[comparename]);
      }
      self.compare(filename, comparename, function(err, isEqual) {
        if (!result && isEqual) {
          result = comparename;
        }
        done(err);
      });
    };
  }), function(err) {
    if (err) {
      onDone(err, false, stat);
    }
    onDone(null, result, stat);
  });
};

// compare two files, given two hash objects
Dedupe.prototype.compare = function(nameA, nameB, onDone) {
  var self = this,
      a = self.hashByName[nameA],
      b = self.hashByName[nameB],
      index = 0,
      maxIndex = a.maxIndex;


  function more(index) {
    var hashA, hashB;
    a.get(index, function(err, hash, bytesRead) {
      self.bytesRead += bytesRead;
      if (err) {
        return onDone(err, false);
      }
      hashA = hash;
      check(hashA, hashB);
    });
    b.get(index, function(err, hash, bytesRead) {
      self.bytesRead += bytesRead;
      if (err) {
        return onDone(err, false);
      }
      hashB = hash;
      check(hashA, hashB);
    });
  }

  function check(hashA, hashB) {
    if (!hashA || !hashB) {
      return;
    }
    // console.log(index, hashA, hashB);
    if (hashA != hashB) {
      a.close();
      b.close();

      return onDone(null, false);
    }
    index++;
    if (index < maxIndex) {
      return more(index);
    }
    a.close();
    b.close();
    return onDone(null, true);
  }
  more(index);
}

module.exports = Dedupe;

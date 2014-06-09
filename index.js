var fs = require('fs'),
    path = require('path'),
    Hash = require('./hash.js'),
    parallel = require('miniq');

function Dedupe(opts) {
  this.inodeByDev = {};
  this.bySize = {};
  this.sizeByName = {};
  this.hashByName = {};
  this.bytesRead = 0;
  this.statCalls = 0;
  this.seen = {};
  this.sync = (opts && opts.async ? false : true);
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

  if (stat.ino !== 0) {
    if (!self.inodeByDev[stat.dev]) {
      self.inodeByDev[stat.dev] = {};
    }
    if (self.inodeByDev[stat.dev][stat.ino]) {
      return onDone(null, self.inodeByDev[stat.dev][stat.ino], stat);
    } else {
      self.inodeByDev[stat.dev][stat.ino] = filename;
    }
  }
  // push before starting the comparison; this allows _findBySize to be async and yet
  // pick up the candidate match
  if (!self.bySize[stat.size]) {
    self.bySize[stat.size] = [ filename ];
    return onDone(null, false, stat);
  } else if (!self.seen[filename]){
    self.bySize[stat.size].push(filename);
  }
  self.seen[filename] = true;
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

  parallel(Math.min(this.bySize[stat.size].length, 8), this.bySize[stat.size].map(function(comparename) {
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
      return onDone(err, false, stat);
    }
    // // remove the file from the list if it is not unique
    // if (!result) {
    //   var index = self.bySize[stat.size].indexOf(filename);
    //   self.bySize[stat.size].splice(index, 1);
    // }

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

    if (self.sync) {
      checkSync(a.getSync(index), b.getSync(index));
      self.bytesRead += a.lastBytes + b.lastBytes;
      return;
    }

    a.get(index, function(err, hash) {
      self.bytesRead += a.lastBytes;
      if (err) {
        return onDone(err, false);
      }
      hashA = hash;
      check(hashA, hashB);
    });
    b.get(index, function(err, hash) {
      self.bytesRead += b.lastBytes;
      if (err) {
        return onDone(err, false);
      }
      hashB = hash;
      check(hashA, hashB);
    });
  }

  function checkSync(hashA, hashB) {
    if (hashA != hashB) {
      a.close();
      b.close();
      onDone(null, false);
      return;
    }
    index++;
    if (index < maxIndex) {
      return more(index);
    }
    a.close();
    b.close();
    onDone(null, true);
  }

  function check(hashA, hashB) {
    if (!hashA || !hashB) {
      return;
    }
    // console.log(index, hashA, hashB);
    if (hashA != hashB) {
      a.close(function() {
        b.close(function() {
          onDone(null, false);
        });
      });
      return;
    }
    index++;
    if (index < maxIndex) {
      return more(index);
    }
    a.close(function() {
      b.close(function() {
        onDone(null, true);
      });
    });
    return;
  }
  more(index);
}

module.exports = Dedupe;

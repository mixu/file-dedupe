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
  // queue to prevent race conditions between two files of the same size
  this.sizePending = {};
  this.sizeQueue = [];
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
/*
    // use statSync to force the order in which calls get queued to be
    // consistent across different traversals as long as the .find call
    // order is consistent across different traversals
    try {
      this._check(filename, fs.statSync(filename), onDone);
    } catch (err) {
      console.error('fs.stat failed for ' + filename + '.', err);
      return onDone(err, false, null);
    }
    */
  } else {
    this._check(filename, stat, onDone);
  }
};

Dedupe.prototype.releaseSize = function(size) {
  this.sizePending[size] = false;
  if (this.sizeQueue.length > 0) {
    this._check.apply(this, this.sizeQueue.shift());
  }
};

Dedupe.prototype._check = function(filename, stat, onDone) {
  var self = this;
  if (!stat.isFile() || stat.size === 0) {
    return onDone(null, false, stat);
  }

  if (this.sizePending[stat.size]) {
    this.sizeQueue.push([filename, stat, onDone]);
    return;
  }
  this.sizePending[stat.size] = true;

  self.sizeByName[filename] = stat.size;

  if (stat.ino !== 0) {
    if (!self.inodeByDev[stat.dev]) {
      self.inodeByDev[stat.dev] = {};
    }
    if (self.inodeByDev[stat.dev][stat.ino]) {
      onDone(null, self.inodeByDev[stat.dev][stat.ino], stat);
      this.releaseSize(stat.size);
      return;
    } else {
      self.inodeByDev[stat.dev][stat.ino] = filename;
    }
  }
  // push before starting the comparison; this allows _findBySize to be async and yet
  // pick up the candidate match
  if (!self.bySize[stat.size]) {
    self.bySize[stat.size] = [ filename ];
    onDone(null, false, stat);
    this.releaseSize(stat.size);
    return;
  } else if (!self.seen[filename]){
    self.bySize[stat.size].push(filename);
  }
  self.seen[filename] = true;
  self._findBySize(filename, stat, function(err, result) {
    onDone(err, result, stat);
    self.releaseSize(stat.size);
  });
};

Dedupe.prototype._findBySize = function(filename, stat, onDone) {
  var self = this,
      result = false;
  // only this file
  if (this.bySize[stat.size].length === 1) {
    return onDone(null, false);
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
      return onDone(err, false);
    }
    onDone(null, result);
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
};

// deduplication is sensitive to input order, because as each file is inputted
// it is matched against the currently known set of potential duplicates,
// which depends on the exact input order.
// To fix issues resulting from this, the canonicalize function re-evaluates
// the comparisons, normalizing the duplication results
Dedupe.prototype.canonicalize = function(onDone) {
  var self = this,
      sizeTasks = [],
      allClusters = [];

  // use the sizeByName object since bySize only has entries
  // for files that do not have the same inode

  var allBySize = {};
  Object.keys(self.sizeByName).forEach(function(name) {
    if (!allBySize[self.sizeByName[name]]) {
      allBySize[self.sizeByName[name]] = [ name ];
    } else {
      allBySize[self.sizeByName[name]].push(name);
    }
  });


  // for each size set
  Object.keys(allBySize).forEach(function(size) {
    if (allBySize[size].length < 2) {
      return; // nop
    }

    var set = allBySize[size],
        setTasks = [],
        clusters = [];
    // iterate over unordered sets (that is, compare each pair once
    // rather than comparing every item to every other item)

    function add(i, j) {
      setTasks.push(function(done) {
        if (!self.hashByName[set[i]]) {
          self.hashByName[set[i]] = new Hash(set[i], self.sizeByName[set[i]]);
        }
        if (!self.hashByName[set[j]]) {
          self.hashByName[set[j]] = new Hash(set[j], self.sizeByName[set[j]]);
        }
        // console.log(i, j, set[i], set[j]);

        self.compare(set[i], set[j], function(err, result) {
          // console.log(set[i], set[j], result);
          if (result) {
            var min = Math.min(i, j),
                max = Math.max(i, j);
            // there can be at most set.length clusters (of size one)
            // iterate over all set.length clusters, and store the items
            // in the lowest-index set that contains at least one of the two items
            // (since equality is transitive)
            for(var k = 0; k < set.length; k++) {
              if (!clusters[k]) {
                continue;
              }
              if (clusters[k][min]) {
                clusters[k][max] = true;
                break;
              } else if (clusters[k][j]) {
                clusters[k][min] = true;
                break;
              }
            }
            // neither item was in any of the clusters, so create a new cluster at
            // the smallert index
            if (k == set.length) {
              clusters[min] = {};
              clusters[min][i] = true;
              clusters[min][j] = true;
            }
          }
          return done(err);
        });
      });
    }

    var i, j;
    for (i = 0; i <= set.length; i++) {
      for (j = i + 1; j < set.length; j++) {
        add(i, j);
      }
    }

    sizeTasks.push(function(done) {
      parallel(Infinity, setTasks, function(err) {
        if (err) {
          return done(err);
        }
        clusters.forEach(function(cluster) {
          if (cluster) {
            allClusters.push(
              Object.keys(cluster)
                .map(function(i) { return set[i]; })
            );
          }
        });
        // console.log('Size', size, set);
        // console.log(clusters);
        done();
      });
    });
  });

  parallel(1, sizeTasks, function(err) {
    var map = {};
    allClusters.forEach(function(cluster) {
      var canonical = cluster.sort(function(a, b) {
        var lengthComparison = a.length - b.length;
        // primary sort: length, secondary sort: name
        if (lengthComparison != 0) {
          return lengthComparison;
        }
        return a.localeCompare(b);
      })[0];
      cluster.forEach(function(name) {
        // console.log(name, '=>', canonical);
        map[name] = canonical;
      });
    });

    onDone(err, map);
  });
};

module.exports = Dedupe;

var fs = require('fs'),
    crypto = require('crypto');

function hash(data) {
  return crypto.createHash('md5').update(data).digest('base64');
}

function Dedupe() {
  this.byInode = {};
  this.bySize = {};
  this.hashByName = {};
}

Dedupe.prototype.find = function(filename) {
  var stat;
  if (typeof filename === 'string') {
    stat = fs.statSync(filename);
  }

  if (stat.ino !== 0 && this.byInode[stat.ino]) {
    return this.byInode[stat.ino];
  }

  var result = this._findBySize(filename, stat);

  if(stat.ino !== 0) {
    this.byInode[stat.inode] = filename;
  }
  return result;
};

Dedupe.prototype._findBySize = function(filename, stat) {
  var result = false;
  if (!this.bySize[stat.size]) {
    return false;
  }
  // calculate hash
  var fhash = hash(fs.readFileSync(filename));
  this.bySize[stat.size].some(function(comparename) {
    if (!this.hashByName[comparename]) {
      this.hashByName[comparename] = hash(fs.readFileSync(comparename));
    }
    if (this.hashByName[comparename] === fhash) {
      result = comparename;
      return true;
    }
    return false;
  });

  this.hashByName[filename] = fhash;
  this.bySize[stat.size] = filename;

  return result;
};

module.exports = Dedupe;

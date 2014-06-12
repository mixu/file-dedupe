var fs = require('fs'),
    path = require('path'),
    assert = require('assert'),
    fixture = require('file-fixture'),
    Dedupe = require('../index.js'),
    parallel = require('miniq');

function nameSort(a, b) {
  return a.localeCompare(b);
}

function removePrefix(prefix) {
  return function(item) {
      return (typeof item === 'string' ? item.substr(prefix.length) : item);
  }
}

function run(tmpDir, onDone) {
  var dedupe = new Dedupe(),
      results = [];

  var tasks = fs.readdirSync(tmpDir).sort(nameSort).map(function(name, i) {
    return function(done) {
      dedupe.find(tmpDir + '/' + name, function(err, result) {
        results[i] = result;
        if (err) {
          return done(err);
        }
        done();
      });
    };
  });
  parallel(1, tasks, function(err) {
    onDone(err, results);
  });
}

exports['tests'] = {

  'can detect simple duplicates': function(onDone) {

    var tmpDir = fixture.dir({
      'a.js': 'aaa',
      'b.js': 'aaa',
      'c.js': 'bbb',
      'd.js': 'aaa',
      'e.js': 'bbb'
    });

    run(tmpDir, function(err, results) {
      if (err) {
        throw err;
      }

      results = results.map(removePrefix(tmpDir + '/'))
      assert.deepEqual(results, [ false, "a.js", false, "a.js", "c.js"]);
      onDone();
    });
  },

  'can detect symlinked duplicates': function(onDone) {
    var tmpDir = fixture.dir({
      'a.js': 'aaa',
      'c.js': 'bbb'
    });

    fs.linkSync(tmpDir + '/' + 'a.js', tmpDir + '/' + 'b.js');

    run(tmpDir, function(err, results) {
      results = results.map(removePrefix(tmpDir + '/'))
      assert.deepEqual(results, [ false, 'a.js', false ]);
      onDone();
    });
  },

  'when queuing two files with the same file size, wait until the pending operation is complete': function(onDone) {
    var tmpDir = fixture.dir({
      'a.js': 'aaa',
      'b.js': 'aaa',
      'c.js': 'aaa',
      'd.js': 'aaa',
    });
    var dedupe = new Dedupe(),
        results = [],
        calls = [];

    // override _findBySize
    var oldFindBySize = dedupe._findBySize;
    dedupe._findBySize = function(filename, stat, onDone) {
      var base = path.basename(filename),
          timeout = 0,
          args = Array.prototype.slice.call(arguments);
      calls.push(base + ' _findBySize');
      switch(base) {
        case 'a.js':
          timeout = 100;
          break;
        case 'b.js':
          timeout = 1000;
          break;
        case 'c.js':
          timeout = 10;
          break;
        case 'd.js':
          timeout = 300;
          break;
      }

      setTimeout(function() {
        oldFindBySize.apply(dedupe, args);
      }, timeout);
    };

    var tasks = fs.readdirSync(tmpDir).sort(nameSort).map(function(name, i) {
      return function(done) {
        calls.push(name + ' find');
        // use statSync to ensure that call order = ._check invocation order
        dedupe.find(tmpDir + '/' + name, fs.statSync(tmpDir + '/' + name), function(err, result) {
          calls.push(name + ' done');
          results[i] = result;
          if (err) {
            return done(err);
          }
          done();
        });
      };
    });
    parallel(Infinity, tasks, function(err) {
      results = results.map(removePrefix(tmpDir + '/'))
      assert.deepEqual(results, [ false, 'a.js', 'a.js', 'a.js' ]);

      assert.deepEqual(calls, [
        // first file of a particular size is resolved instantly
        'a.js find',
        'a.js done',
        // calls go in map order
        'b.js find',
        'c.js find',
        'd.js find',
        // thanks to the per-size queue, the calls
        // are attempted in call order and resolved in call order
        'b.js _findBySize',
        'b.js done',
        'c.js _findBySize',
        'c.js done',
        'd.js _findBySize',
        'd.js done' ]);
      onDone();
    });
  }

};


// if this module is the script being run, then run the tests:
if (module == require.main) {
  var mocha = require('child_process').spawn('mocha', [
    '--colors', '--ui', 'exports', '--reporter', 'spec', __filename
  ]);
  mocha.stderr.on('data', function (data) {
    if (/^execvp\(\)/.test(data)) {
     console.log('Failed to start child process. You need mocha: `npm install -g mocha`');
    }
  });
  mocha.stdout.pipe(process.stdout);
  mocha.stderr.pipe(process.stderr);
}

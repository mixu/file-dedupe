var fs = require('fs'),
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

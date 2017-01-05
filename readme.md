# file-dedupe

Fast duplicate file detection library

## Installation

    npm install --save file-dedupe

## Algorithm

The algorithm is as follows:

- Files are indexed by inode and device, files with the same inode + device are considered equal. If the platform does not support inode ids, then this check is skipped.
- Files are then indexed by size; only file with the same size are compared.
- During comparison, the files are read at block sizes increasing in powers of two, starting with 2k. The blocks are hashed and compared, and if they do not match the comparison is stopped early (often without having to read the full file). If all the hashes are equal, then the files are considered to be equal.
- Hashes are only computed when needed and cached in memory. Since the hash block size increases in powers of two, only a few dozen hashes are needed even for large files (reducing memory usage compared to a fixed hash block size).
- Non-files always return false.

## Performance

`findup` is quite fast - it is within 2x of the fastest duplicate finders written in C/C++. Based on the V8 profiler output, about 40% of the time is spent on I/O, 13% on crypto and 11% on file traversal, so any further gains in performance will need to come from I/O optimizations rather than code optimizations.

    rdfind: 2.22user 1.96system 0:04.24elapsed 98%CPU (0avgtext+0avgdata 57984maxresident)k
    duff: 2.66user 1.66system 0:04.34elapsed 99%CPU (0avgtext+0avgdata 80432maxresident)k
    fslint: 9.49user 5.78system 0:11.01elapsed 138%CPU (0avgtext+0avgdata 29632maxresident)k
    findup: 5.36user 3.29system 0:08.20elapsed 105%CPU (0avgtext+0avgdata 717056maxresident)k

BTW, you may notice that `file-dedupe` defaults to sync I/O. This is because the async I/O seems to have significant overhead for typical FS tasks. You can test this out by passing the `--async` flag on your system.

## API

- `new Dedupe({ async: false})`: creates a new class, which holds all the cached metadata. Options:
  - `async`: whether to use async or sync I/O for hashing files. Defaults to sync, which is usually faster.
- `dedupe.find(file, [stat], onDone)`: callback `(err, result)` where result is either `false` or a full path to a file that was previously deduplicated. You can optionally pass in a `fs.Stat` object to avoid having to do another `fs.stat` call in dedupe.

For a usage example, see `bin/findup`.

## Command line tool

`file-dedupe` ships with `findup`, a basic CLI tool for finding duplicates. To get it, install the module globally: `npm install -g file-dedupe`.

Usage: `findup --include <path>`

Options:

    --include <path> Include path
    --stdin          Read list from stdin
    --list           Return full paths (plain output, suitable for xargs)
    --json           Return JSON output
    --omit-first     Omit the first file in each set of matches
    --async          Use async I/O instead of sync I/O (async is often slower)

    --delete         Delete duplicate files (all files will be deleted unless
                     --omit-first is set)

    --help           Display help
    -v, --version    Display version

For example, to find all duplicates in current directory and below:

    findup --include . > report.txt

Note that progress is reported on stderr, and output is produced on stdout, so you can just pipe the output to ignore the status information.

Advanced selection:

If you want to select files by size or by user, you can use the Unix `find` command to filter out files. For example:

    find . -name "*.csv" -print | findup --stdin > report.txt

To only look at files with size > 100k:

    find . -size +100k -print | findup --stdin > report.txt

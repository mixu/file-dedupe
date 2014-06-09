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

## API

- `new Dedupe()`: creates a new class, which holds all the cached metadata
- `dedupe.find(file, [stat], onDone)`: callback `(err, result)` where result is either `false` or a full path to a file that was previously deduplicated. You can optionally pass in a `fs.Stat` object to avoid performing multiple stat operations

## Command line tool

`file-dedupe` ships with `findup`, a basic CLI tool for finding duplicates.

Usage: `findup --include <path>`

Options:

    --include <path> Include path
    --stdin          Read list from stdin
    --list           Return full paths (plain output, suitable for xargs)
    --json           Return JSON output
    --omit-first     Omit the first file in each set of matches
    --help           Display help
    -v, --version    Display version

Examples:

    `findup --include . > report.txt`: find all duplicates in current directory and below

Note that progress is reported on stderr, and output is produced on stdout, so you can just pipe the output to ignore the status information.

Advanced selection:

If you want to select files by size or by user, you can use the Unix `find` command to filter out files. For example:

    find . -name "*.csv" -print | findup --stdin > report.txt

To only look at files with size > 100k:

    find . -size +100k -print | findup --stdin > report.txt

# file-dedupe

Fast duplicate file detection library

## Algorithm

The algorithm is as follows:

- Files are indexed by inode and device, files with the same inode + device are considered equal. If the platform does not support inode ids, then this check is skipped.
- Files are then indexed by size; only file with the same size are compared.
- During comparison, the files are read at block sizes increasing in powers of two, starting with 4k. The blocks are hashed and compared, and if they do not match the comparison is stopped early (often without having to read the full file). If all the hashes are equal, then the files are considered to be equal.
- Hashes are only computed when needed and cached in memory. Since the hash block size increases in powers of two, only a few dozen hashes are needed even for large files (reducing memory usage compared to a fixed hash block size).
- non-files always return false

## API

- `new Dedupe()`: creates a new class, which holds all the cached metadata
- `dedupe.find(file, onDone)`: callback `(err, result)` where result is either `false` or a full path to a file that was previously deduplicated.

`file` can be a single path to a file, or an array of files.

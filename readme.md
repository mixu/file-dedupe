readme.md

## Algorithm

The algorithm is as follows:

- files are indexed by inode, files with the same inode are considered equal (skipped on platforms which do not use inodes like Windows)
- files are indexed by size; only file with the same size are compared
- during comparison, the files are read at block sizes increasing in powers of two, starting with 4k. the blocks are hashed and compared. If the full file is hashed, then the files are considered to be equal.
- non-files always return false

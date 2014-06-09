findup

Options:

    --include <path> Include path
    --full  Return full paths (bare output, suitable for xargs)
    --json  Return JSON output
    --min-size <size> Filter by min size
    --max-size <size> Filter by max size
    --user <uid>  Filter by user
    --omit-first     Omit the first file in each set of matches
    --verbose Increase verbosity
    -v Display version

Examples:

  `findup .`: find all duplicates in current directory and below
  `findup . --max-size 100k`: find all duplicate files over 100K in size
  `findup . --user `id -u``: find all duplicate files belonging to me

Piping into findup: you can also pipe into findup from `find` or some other command.
reads a list of files from standard input (eg., as produced by "find . -print") and looks for identical files

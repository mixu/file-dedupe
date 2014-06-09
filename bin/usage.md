
Usage: findup --include <path>

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


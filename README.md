# code-comment-splitter

A merge tool for Jujutsu (jj) that splits comment-only changes from code changes. When you run `jj split`, this tool filters out changes that are purely comments or whitespace, keeping only real code modifications.

## Quick Start

No installation needed! Run directly from JSR with Deno:

```toml
# Add to your jj config (~/.config/jj/config.toml)
[merge-tools.split-comments]
program = "deno"
edit-args = [
  "run",
  "--allow-read=/tmp",
  "--allow-write=/tmp",
  "--allow-env=JJ_SPLIT_LOG",
  "jsr:@farnoy/jj-comment-splitter",
  "$left",
  "$right"
]
```

Then use it:

```bash
jj split --tool split-comments
```

### What it does

When you have mixed changes (code + comments), running `jj split --tool split-comments` will:
- Create one commit with only the non-comment changes
- Leave comment-only changes in your working copy
- Restore any deleted comments (so you don't accidentally remove documentation)

Supports `//` and `#` style comments.

### Permissions

The tool needs:
- `--allow-read=/tmp` - jj creates temporary directories in /tmp for the split operation
- `--allow-write=/tmp` - To write the filtered changes back
- `--allow-env=JJ_SPLIT_LOG` - To read the optional `JJ_SPLIT_LOG` environment variable for verbose output

### Verbose logging

Set `JJ_SPLIT_LOG=1` to see detailed output:

```bash
JJ_SPLIT_LOG=1 jj split --tool split-comments
```

---

## Development

### Running locally

Clone the repository and run with Deno:

```bash
git clone https://github.com/farnoy/code-comment-splitter.git
cd code-comment-splitter

# Run directly
deno task start <leftDir> <rightDir>

# Or with full permissions
deno run --allow-read --allow-write --allow-env src/cli/jj-merge-tool.ts <leftDir> <rightDir>
```

### Testing

```bash
deno task test      # Run tests
deno task check     # Type check
deno task dev       # Watch mode
```

### Local jj config

To use your local version instead of GitHub:

```toml
[merge-tools.split-comments]
program = "deno"
edit-args = [
  "run",
  "--allow-read=/tmp",
  "--allow-write=/tmp",
  "--allow-env=JJ_SPLIT_LOG",
  "/absolute/path/to/src/cli/jj-merge-tool.ts",
  "$left",
  "$right"
]
```

### Project structure

```
code-comment-splitter/
├── src/
│   ├── cli/jj-merge-tool.ts           # CLI entry point
│   ├── lib/splitNonComment.ts         # Core logic (LCS-based diff algorithm)
│   └── __tests__/splitNonComment.test.ts
└── deno.json
```

## License

ISC

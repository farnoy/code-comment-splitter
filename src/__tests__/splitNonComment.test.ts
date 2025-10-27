import { join, dirname, relative } from '@std/path'
import { assertEquals, fail } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { processTreesKeepingNonComments, mergeFileKeepingNonComments, isCommentOrWhitespace } from '../lib/splitNonComment.ts'

class TestDir {
  constructor(public path: string, private seed: Record<string, string>) {}

  static async seed(data: Record<string, string>) {
    const dir = await Deno.makeTempDir({ prefix: 'comment-splitter-test' })
    for (const [relPath, text] of Object.entries(data)) {
      await Deno.mkdir(join(dir, dirname(relPath)), { recursive: true })
      await Deno.writeTextFile(join(dir, relPath), text, { createNew: true })
    }
    return new TestDir(dir, data)
  }

  async get(relPath: string) {
    return await Deno.readTextFile(join(this.path, relPath))
  }

  async [Symbol.asyncDispose]() {
    await Deno.remove(this.path, { recursive: true })
  }
}

async function testSplit(leftFiles: Record<string, string>, rightFiles: Record<string, string>) {
  await using left = await TestDir.seed(leftFiles)
  await using right = await TestDir.seed(rightFiles)

  await processTreesKeepingNonComments(left.path, right.path)

  const results: Record<string, string> = {}
  const allFiles = new Set([...Object.keys(leftFiles), ...Object.keys(rightFiles)])
  for (const filename of allFiles) {
    try {
      results[filename] = await right.get(filename)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        continue
      }
      throw e
    }
  }
  return results
}

describe('Unit: isCommentOrWhitespace', () => {
  it('detects // comments', () => {
    assertEquals(isCommentOrWhitespace('// comment'), true)
    assertEquals(isCommentOrWhitespace('   // indented'), true)
  })

  it('detects # comments', () => {
    assertEquals(isCommentOrWhitespace('# comment'), true)
    assertEquals(isCommentOrWhitespace('   # indented'), true)
  })

  it('detects whitespace', () => {
    assertEquals(isCommentOrWhitespace(''), true)
    assertEquals(isCommentOrWhitespace('   '), true)
    assertEquals(isCommentOrWhitespace('\t\t'), true)
  })

  it('rejects code', () => {
    assertEquals(isCommentOrWhitespace('code'), false)
    assertEquals(isCommentOrWhitespace('  code'), false)
  })
})

describe('Unit: mergeFileKeepingNonComments', () => {
  it('handles null left (new file)', () => {
    const result = mergeFileKeepingNonComments(null, 'code\n// comment\n')
    assertEquals(result, 'code\n')
  })

  it('preserves trailing newline from left', () => {
    const result = mergeFileKeepingNonComments('a\n', 'a\n// comment')
    assertEquals(result, 'a\n')
  })

  it('handles no trailing newline', () => {
    const result = mergeFileKeepingNonComments('a', 'a\n// comment')
    assertEquals(result, 'a')
  })

  it('handles empty left file', () => {
    const result = mergeFileKeepingNonComments('', '// just comments\n')
    assertEquals(result, '')
  })

  it('handles tabs and spaces', () => {
    const result = mergeFileKeepingNonComments('code\n', 'code\n\t// tab comment\n    # space comment\n')
    assertEquals(result, 'code\n')
  })
})

describe('Inline Comments', () => {
  it('strips inline comments with space separator', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\n' },
      { 'code.ts': 'const x = 1 // comment\n' }
    )
    assertEquals(result['code.ts'], 'const x = 1\n')
  })

  it('strips inline comments with tab separator', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\n' },
      { 'code.ts': 'const x = 1\t// comment\n' }
    )
    assertEquals(result['code.ts'], 'const x = 1\n')
  })

  it('keeps inline comments without space (not detected as comment)', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\n' },
      { 'code.ts': 'const x = 1// no space\n' }
    )
    assertEquals(result['code.ts'], 'const x = 1// no space\n')
  })

  it('strips inline comments on method chains', async () => {
    const result = await testSplit(
      { 'code.ts': 'const items = data\n  .filter(x => x !== null)\n  .map(x => x.value)\n' },
      { 'code.ts': 'const items = data\n  .filter(x => x !== null) // remove nulls\n  .map(x => x.value) // extract\n' }
    )
    assertEquals(result['code.ts'], 'const items = data\n  .filter(x => x !== null)\n  .map(x => x.value)\n')
  })
})

describe('Full-Line Comments', () => {
  it('strips full-line comments between unchanged code', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\nconst y = 2\n' },
      { 'code.ts': 'const x = 1\n// This is a comment\nconst y = 2\n' }
    )
    assertEquals(result['code.ts'], 'const x = 1\nconst y = 2\n')
  })

  it('strips comments in new insertions', async () => {
    const result = await testSplit(
      { 'code.ts': 'a\n' },
      { 'code.ts': 'a\n// comment\ncode\n# note\n' }
    )
    assertEquals(result['code.ts'], 'a\ncode\n')
  })

  it('strips comments from multiple separated hunks', async () => {
    const result = await testSplit(
      { 'code.ts': 'function first() {\n  return 1\n}\n\nconst sep = "---"\n\nfunction second() {\n  return 2\n}\n' },
      { 'code.ts': 'function first() {\n  // First function\n  return 1\n}\n\nconst sep = "---"\n\nfunction second() {\n  // Second function\n  return 2\n}\n' }
    )
    assertEquals(result['code.ts'], 'function first() {\n  return 1\n}\n\nconst sep = "---"\n\nfunction second() {\n  return 2\n}\n')
  })

  it('strips comments but preserves blank lines even when no code is added', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\n' },
      { 'code.ts': 'const x = 1\n\n// comment\n   \n' }
    )
    // Blank lines are preserved for code structure, comments are removed
    assertEquals(result['code.ts'], 'const x = 1\n\n\n')
  })
})

describe('Mixed Hunks (Refactorings)', () => {
  it('strips comment when code is replaced with comment-only line', async () => {
    const result = await testSplit(
      { 'code.ts': 'old\n' },
      { 'code.ts': '// new as comment\n' }
    )
    assertEquals(result['code.ts'], '')
  })

  it('strips comments in mixed deletion/insertion hunks', async () => {
    const result = await testSplit(
      { 'code.ts': '// old comment\ncode1\n// another comment\ncode2\n' },
      { 'code.ts': 'code1\n// new comment\ncode3\n' }
    )
    assertEquals(result['code.ts'], 'code1\ncode3\n')
  })

  it('strips comments in large refactorings', async () => {
    const result = await testSplit(
      {
        'code.ts': `async function oldApproach() {
  // Create temp directory for processing
  const tmp = path.join(os.tmpdir(), "processing");
  const results = await Promise.all(
    items.map(async (item) => {
      const file = await writeToTemp(tmp, item);  // write to disk
      const output = await processFile(file);
      return output;
    })
  );

  // Clean up temp files
  await fs.rm(tmp, { recursive: true });
  return results;
}
`
      },
      {
        'code.ts': `async function newApproach() {
  // Modern in-memory processing
  const results = await Promise.all(
    items.map(async (item) => {
      return await processInMemory(item);
    })
  );

  return results;
}
`
      }
    )
    assertEquals(result['code.ts'], `async function newApproach() {
  const results = await Promise.all(
    items.map(async (item) => {
      return await processInMemory(item);
    })
  );

  return results;
}
`)
  })

  it('keeps changes when code and comment both change together', async () => {
    const result = await testSplit(
      { 'code.ts': 'import { foo, bar, baz } from "lib"\nimport { old } from "old-lib"\n\nfunction main() {\n  return foo()\n}\n' },
      { 'code.ts': 'import { foo, bar } from "lib"\nimport { newThing } from "new-lib"\n\nfunction main() {\n  // Call foo\n  return foo()\n}\n' }
    )
    assertEquals(result['code.ts'], 'import { foo, bar } from "lib"\nimport { newThing } from "new-lib"\n\nfunction main() {\n  return foo()\n}\n')
  })

  it('allows deletion of comments', async () => {
    const result = await testSplit(
      { 'code.ts': 'code1\n// comment\ncode2\n' },
      { 'code.ts': 'code1\ncode2\n' }
    )
    assertEquals(result['code.ts'], 'code1\ncode2\n')
  })

  it('allows deletion of whitespace', async () => {
    const result = await testSplit(
      { 'code.ts': 'code1\n\ncode2\n' },
      { 'code.ts': 'code1\ncode2\n' }
    )
    assertEquals(result['code.ts'], 'code1\ncode2\n')
  })

  it('preserves old comments but strips new comments in neighboring hunks', async () => {
    const result = await testSplit(
      {
        'code.ts': `function foo() {
  // Existing comment from previous commit
  return 1
}

function bar() {
  return 2
}
`
      },
      {
        'code.ts': `function foo() {
  // Existing comment from previous commit
  return 1
}

function bar() {
  // New comment added in this change
  return 2
  const x = 3
}
`
      }
    )
    assertEquals(result['code.ts'], `function foo() {
  // Existing comment from previous commit
  return 1
}

function bar() {
  return 2
  const x = 3
}
`)
  })
})

describe('Special Characters', () => {
  it('preserves URLs with https:// and http://', async () => {
    const result = await testSplit(
      { 'code.ts': 'const apiUrl = "https://api.example.com"\n' },
      { 'code.ts': 'const apiUrl = "https://api.example.com"\nconst fallback = "http://backup.example.com"\n' }
    )
    assertEquals(result['code.ts'], 'const apiUrl = "https://api.example.com"\nconst fallback = "http://backup.example.com"\n')
  })

  it('preserves hash symbols in hex colors', async () => {
    const result = await testSplit(
      { 'code.py': 'color = "#ff0000"\n' },
      { 'code.py': 'color = "#ff0000"\nbackground = "#00ff00"\n' }
    )
    assertEquals(result['code.py'], 'color = "#ff0000"\nbackground = "#00ff00"\n')
  })

  it('strips Python # comments but keeps hash in code', async () => {
    const result = await testSplit(
      { 'code.py': 'data = {"key": "value"}\n' },
      { 'code.py': 'data = {"key": "value"}\n# This is a comment\nhash_color = "#ff0000"\n' }
    )
    assertEquals(result['code.py'], 'data = {"key": "value"}\nhash_color = "#ff0000"\n')
  })

  it('preserves regex patterns with slashes', async () => {
    const result = await testSplit(
      { 'code.ts': 'const urlRegex = /https?:\\/\\//\n' },
      { 'code.ts': 'const urlRegex = /https?:\\/\\//\nconst emailRegex = /[^@]+@[^@]+/\n' }
    )
    assertEquals(result['code.ts'], 'const urlRegex = /https?:\\/\\//\nconst emailRegex = /[^@]+@[^@]+/\n')
  })

  it('preserves template literals with URLs', async () => {
    const result = await testSplit(
      { 'code.ts': 'const apiUrl = `https://api.example.com`\nconst path = "/users"\n' },
      { 'code.ts': 'const apiUrl = `https://api.example.com`\nconst path = "/users"\nconst query = "?limit=10"\n' }
    )
    assertEquals(result['code.ts'], 'const apiUrl = `https://api.example.com`\nconst path = "/users"\nconst query = "?limit=10"\n')
  })

  it('keeps string literals with // in mixed hunks', async () => {
    const result = await testSplit(
      { 'code.ts': 'const msg = "use comments"\nconst url = "https://example.com"\n' },
      { 'code.ts': 'const msg = "use // comments"\nconst url = "https://example.com/api"\nconst info = "new line"\n' }
    )
    assertEquals(result['code.ts'], 'const msg = "use // comments"\nconst url = "https://example.com/api"\nconst info = "new line"\n')
  })

  it('handles escaped quotes in strings with inline comments', async () => {
    const result = await testSplit(
      { 'code.ts': 'const msg = "He said \\"hello\\""\n' },
      { 'code.ts': 'const msg = "He said \\"hello // world\\""  // added\n' }
    )
    assertEquals(result['code.ts'], 'const msg = "He said \\"hello // world\\""\n')
  })

  it('keeps block comments (not supported)', async () => {
    const result = await testSplit(
      { 'code.ts': 'function foo() {\n  return 1\n}\n' },
      { 'code.ts': '/** JSDoc comment */\nfunction foo() {\n  return 1\n}\n' }
    )
    assertEquals(result['code.ts'], '/** JSDoc comment */\nfunction foo() {\n  return 1\n}\n')
  })
})

describe('File Operations', () => {
  it('strips comments from new files', async () => {
    const result = await testSplit(
      {},
      { 'new.ts': '// a\n# b\ncode\n' }
    )
    assertEquals(result['new.ts'], 'code\n')
  })

  it('handles new files with only comments', async () => {
    const result = await testSplit(
      {},
      { 'comments.ts': '// comment 1\n# comment 2\n  \n' }
    )
    assertEquals(result['comments.ts'], '\n')
  })

  it('restores deleted files', async () => {
    const result = await testSplit(
      { 'deleted.ts': 'original content\n' },
      {}
    )
    assertEquals(result['deleted.ts'], 'original content\n')
  })

  it('handles files in subdirectories', async () => {
    const result = await testSplit(
      { 'subdir/nested/file.ts': 'original\n' },
      { 'subdir/nested/file.ts': 'original\n// added comment\n' }
    )
    assertEquals(result['subdir/nested/file.ts'], 'original\n')
  })

  it('handles multiple files independently', async () => {
    const result = await testSplit(
      { 'a.ts': 'const x = 1\n', 'b.ts': 'const y = 2\n' },
      { 'a.ts': 'const x = 1 // comment\n', 'b.ts': 'const y = 2\nconst z = 3\n' }
    )
    assertEquals(result['a.ts'], 'const x = 1\n')
    assertEquals(result['b.ts'], 'const y = 2\nconst z = 3\n')
  })

  it('skips JJ-INSTRUCTIONS file (does not strip comments)', async () => {
    const result = await testSplit(
      {},
      { 'JJ-INSTRUCTIONS': '// This is a jujutsu instruction comment\noriginal instructions\n# another comment\n' }
    )
    assertEquals(result['JJ-INSTRUCTIONS'], '// This is a jujutsu instruction comment\noriginal instructions\n# another comment\n')
  })

  it('logs when verbose mode enabled', async () => {
    await using left = await TestDir.seed({ 'logged.ts': 'code\n' })
    await using right = await TestDir.seed({ 'logged.ts': 'code\n// comment\n' })

    await processTreesKeepingNonComments(left.path, right.path, true)

    const out = await right.get('logged.ts')
    assertEquals(out, 'code\n')
  })
})

describe('Edge Cases', () => {
  it('handles files without trailing newlines', async () => {
    const result = await testSplit(
      { 'code.ts': 'line1\nline2' },
      { 'code.ts': 'line1\n// comment\nline2' }
    )
    assertEquals(result['code.ts'], 'line1\nline2')
  })

  it('handles single-line file changes', async () => {
    const result = await testSplit(
      { 'code.ts': 'const x = 1\n' },
      { 'code.ts': 'const y = 2\n' }
    )
    assertEquals(result['code.ts'], 'const y = 2\n')
  })

  it('handles changes only on first line', async () => {
    const result = await testSplit(
      { 'code.ts': 'old\nkeep\nkeep\n' },
      { 'code.ts': 'new\nkeep\nkeep\n' }
    )
    assertEquals(result['code.ts'], 'new\nkeep\nkeep\n')
  })

  it('handles first-line comment stripping', async () => {
    const result = await testSplit(
      { 'code.ts': 'code\nkeep\n' },
      { 'code.ts': '// comment\ncode\nkeep\n' }
    )
    assertEquals(result['code.ts'], 'code\nkeep\n')
  })
})

describe('Blank Line Preservation', () => {
  it('preserves blank lines between code when adding comments', async () => {
    const result = await testSplit(
      {
        'types.ts': `export type Status = "active" | "inactive"

export interface User {
  name: string
}
`
      },
      {
        'types.ts': `export type Status = "active" | "inactive"

// User configuration interface
export interface User {
  name: string
}
`
      }
    )
    // The blank line between Status and User should be preserved
    assertEquals(result['types.ts'], `export type Status = "active" | "inactive"

export interface User {
  name: string
}
`)
  })

  it('preserves blank lines when adding code and comments together', async () => {
    const result = await testSplit(
      {
        'module.ts': `function first() {
  return 1
}
`
      },
      {
        'module.ts': `function first() {
  return 1
}

// Second function
function second() {
  return 2
}
`
      }
    )
    // The blank line before the comment should be preserved
    assertEquals(result['module.ts'], `function first() {
  return 1
}

function second() {
  return 2
}
`)
  })
})

describe('Real-World Complex Scenarios', () => {
  it('handles TypeScript with imports, inline comments, URLs, and method chains', async () => {
    const result = await testSplit(
      {
        'api.ts': `import { fetch } from "lib"

const API_BASE = "https://api.example.com"

export async function getUsers() {
  const response = await fetch(\`\${API_BASE}/users\`)
  const data = await response.json()
  return data
    .filter(u => u.active)
    .map(u => u.name)
}
`
      },
      {
        'api.ts': `import { fetch, logger } from "lib"

const API_BASE = "https://api.example.com"
const FALLBACK = "http://backup.example.com"

export async function getUsers() {
  // Fetch users from API
  const response = await fetch(\`\${API_BASE}/users\`)
  const data = await response.json()
  return data
    .filter(u => u.active) // only active users
    .map(u => u.name) // extract names
}
`
      }
    )
    assertEquals(result['api.ts'], `import { fetch, logger } from "lib"

const API_BASE = "https://api.example.com"
const FALLBACK = "http://backup.example.com"

export async function getUsers() {
  const response = await fetch(\`\${API_BASE}/users\`)
  const data = await response.json()
  return data
    .filter(u => u.active)
    .map(u => u.name)
}
`)
  })

  it('handles Python with hash colors, dict literals, and comments', async () => {
    const result = await testSplit(
      {
        'config.py': `THEME = {
    "primary": "#ff0000",
    "secondary": "#00ff00"
}

def process(data):
    return data * 2
`
      },
      {
        'config.py': `# Configuration module
THEME = {
    "primary": "#ff0000",
    "secondary": "#00ff00",
    "accent": "#0000ff"
}

def process(data):
    # Double the input value
    return data * 2
`
      }
    )
    assertEquals(result['config.py'], `THEME = {
    "primary": "#ff0000",
    "secondary": "#00ff00",
    "accent": "#0000ff"
}

def process(data):
    return data * 2
`)
  })
})

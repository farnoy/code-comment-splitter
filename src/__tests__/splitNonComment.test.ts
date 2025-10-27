import { join, dirname } from '@std/path'
import { assertEquals } from '@std/assert'
import { processTreesKeepingNonComments, mergeFileKeepingNonComments, isCommentOrWhitespace } from '../lib/splitNonComment.ts'

async function ensureDir(p: string) {
  await Deno.mkdir(p, { recursive: true })
}

Deno.test('keeps only non-comment insertions', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'file.txt'
    await ensureDir(dirname(join(left, file)))
    await Deno.writeTextFile(join(left, file), 'a\n')

    await ensureDir(dirname(join(right, file)))
    await Deno.writeTextFile(join(right, file), 'a\n// comment\ncode\n# note\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'a\ncode\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('deletion of comment is restored; deletion of code is kept', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'file.txt'
    await Deno.writeTextFile(join(left, file), 'code1\n// comment\ncode2\n')
    await Deno.writeTextFile(join(right, file), 'code1\ncode2\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'code1\n// comment\ncode2\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('replacement: keep right if non-comment; else restore left', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'file.txt'
    await Deno.writeTextFile(join(left, file), 'old\n')
    await Deno.writeTextFile(join(right, file), '// new as comment\n')

    await processTreesKeepingNonComments(left, right)
    let out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'old\n')

    await Deno.writeTextFile(join(right, file), 'new\n')
    await processTreesKeepingNonComments(left, right)
    out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'new\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('file only in right: strip comments', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'only.txt'
    await Deno.writeTextFile(join(right, file), '// a\n# b\ncode\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'code\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('file only in left: restore to right', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'deleted.txt'
    await Deno.writeTextFile(join(left, file), 'original content\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'original content\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('files without trailing newlines', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'no-newline.txt'
    await Deno.writeTextFile(join(left, file), 'line1\nline2')
    await Deno.writeTextFile(join(right, file), 'line1\n// comment\nline2')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'line1\nline2')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('files with whitespace-only lines', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'whitespace.txt'
    await Deno.writeTextFile(join(left, file), 'code1\n\ncode2\n')
    await Deno.writeTextFile(join(right, file), 'code1\ncode2\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'code1\n\ncode2\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('files in subdirectories', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'subdir/nested/file.txt'
    await ensureDir(dirname(join(left, file)))
    await Deno.writeTextFile(join(left, file), 'original\n')

    await ensureDir(dirname(join(right, file)))
    await Deno.writeTextFile(join(right, file), 'original\n// added comment\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'original\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('skips JJ-INSTRUCTIONS file', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'JJ-INSTRUCTIONS'
    await Deno.writeTextFile(join(right, file), 'original instructions\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'original instructions\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('mixed deletions and insertions', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'mixed.txt'
    await Deno.writeTextFile(join(left, file), '// old comment\ncode1\n// another comment\ncode2\n')
    await Deno.writeTextFile(join(right, file), 'code1\n// new comment\ncode3\n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, '// old comment\ncode1\n// another comment\ncode3\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('file only in right with all comments', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'all-comments.txt'
    await Deno.writeTextFile(join(right, file), '// comment 1\n# comment 2\n  \n')

    await processTreesKeepingNonComments(left, right)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, '\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('verbose logging enabled', async () => {
  const root = await Deno.makeTempDir()
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    await ensureDir(left)
    await ensureDir(right)

    const file = 'logged.txt'
    await Deno.writeTextFile(join(left, file), 'code\n')
    await Deno.writeTextFile(join(right, file), 'code\n// comment\n')

    await processTreesKeepingNonComments(left, right, true)

    const out = await Deno.readTextFile(join(right, file))
    assertEquals(out, 'code\n')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('isCommentOrWhitespace detects comments', () => {
  assertEquals(isCommentOrWhitespace('// comment'), true)
  assertEquals(isCommentOrWhitespace('# comment'), true)
  assertEquals(isCommentOrWhitespace('   // indented'), true)
  assertEquals(isCommentOrWhitespace('   # indented'), true)
  assertEquals(isCommentOrWhitespace(''), true)
  assertEquals(isCommentOrWhitespace('   '), true)
  assertEquals(isCommentOrWhitespace('\t\t'), true)
  assertEquals(isCommentOrWhitespace('code'), false)
  assertEquals(isCommentOrWhitespace('  code'), false)
})

Deno.test('mergeFileKeepingNonComments with null left', () => {
  const right = 'code\n// comment\n'
  const result = mergeFileKeepingNonComments(null, right)
  assertEquals(result, 'code\n')
})

Deno.test('mergeFileKeepingNonComments preserves trailing newline from left', () => {
  const left = 'a\n'
  const right = 'a\n// comment'
  const result = mergeFileKeepingNonComments(left, right)
  assertEquals(result, 'a\n')
})

Deno.test('mergeFileKeepingNonComments no trailing newline', () => {
  const left = 'a'
  const right = 'a\n// comment'
  const result = mergeFileKeepingNonComments(left, right)
  assertEquals(result, 'a')
})

Deno.test('mergeFileKeepingNonComments empty left file', () => {
  const left = ''
  const right = '// just comments\n'
  const result = mergeFileKeepingNonComments(left, right)
  assertEquals(result, '')
})

Deno.test('mergeFileKeepingNonComments with tabs and spaces', () => {
  const left = 'code\n'
  const right = 'code\n\t// tab comment\n    # space comment\n'
  const result = mergeFileKeepingNonComments(left, right)
  assertEquals(result, 'code\n')
})

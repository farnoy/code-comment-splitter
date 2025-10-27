import { join, dirname } from '@std/path'

export function isCommentOrWhitespace(line: string): boolean {
  return /^\s*(?:\/\/|#)/.test(line) || /^\s*$/.test(line)
}

function stripInlineComment(line: string): string {
  let commentStart = -1
  let inString = false
  let stringChar = ''

  // Find // or # that's either at start or preceded by whitespace, but not inside strings
  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    // Track string boundaries
    if ((char === '"' || char === "'" || char === '`') && (i === 0 || line[i - 1] !== '\\')) {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = ''
      }
    }

    // Skip comment detection inside strings
    if (inString) continue

    if (char === '/' && i + 1 < line.length && line[i + 1] === '/') {
      // Check if at start or preceded by whitespace
      if (i === 0 || /\s/.test(line[i - 1])) {
        commentStart = i
        break
      }
    } else if (char === '#') {
      // Check if at start or preceded by whitespace
      if (i === 0 || /\s/.test(line[i - 1])) {
        commentStart = i
        break
      }
    }
  }

  if (commentStart === -1) {
    return line
  }

  return line.substring(0, commentStart).trimEnd()
}

function equalIgnoringTrailingWhitespace(a: string, b: string): boolean {
  const aStripped = stripInlineComment(a).trimEnd()
  const bStripped = stripInlineComment(b).trimEnd()

  // If both lines have no code (only comments/whitespace), treat as different
  if (aStripped === '' && bStripped === '') {
    return a.trimEnd() === b.trimEnd()
  }

  return aStripped === bStripped
}

function normalize(text: string): { lines: string[]; eol: string } {
  const eol = text.endsWith('\n') ? '\n' : ''
  const lines = text.split(/\n/)
  if (eol && lines[lines.length - 1] === '') lines.pop()
  return { lines, eol }
}

function lcs(a: string[], b: string[], eq: (x: string, y: string) => boolean): Array<'eq'|'del'|'ins'> {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (eq(a[i], b[j])) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Array<'eq'|'del'|'ins'> = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      ops.push('eq'); i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push('del'); i++
    } else {
      ops.push('ins'); j++
    }
  }
  while (i < n) { ops.push('del'); i++ }
  while (j < m) { ops.push('ins'); j++ }
  return ops
}

export function mergeFileKeepingNonComments(leftText: string | null, rightText: string): string {
  const leftNorm = (leftText !== null && leftText !== '') ? normalize(leftText) : { lines: [] as string[], eol: rightText.endsWith('\n') ? '\n' : '' }
  const rightNorm = normalize(rightText)
  const ops = lcs(leftNorm.lines, rightNorm.lines, equalIgnoringTrailingWhitespace)

  const out: string[] = []
  let i = 0, j = 0

  for (let k = 0; k < ops.length; ) {
    if (ops[k] === 'eq') {
      const leftLine = leftNorm.lines[i]
      const rightLine = rightNorm.lines[j]

      // If lines are identical, keep as-is (preserves existing comments)
      if (leftLine.trimEnd() === rightLine.trimEnd()) {
        out.push(leftLine)
      } else {
        // Lines are equal ignoring comments, so strip the newly added comment
        const stripped = stripInlineComment(leftLine)
        out.push(stripped)
      }
      i++; j++; k++
      continue
    }

    // Collect a hunk of non-eq operations
    const dels: string[] = []
    const ins: string[] = []

    while (k < ops.length && ops[k] !== 'eq') {
      if (ops[k] === 'del') {
        dels.push(leftNorm.lines[i])
        i++
      } else {
        ins.push(rightNorm.lines[j])
        j++
      }
      k++
    }

    // Process insertions: preserve blank lines, skip comments, strip inline comments from code
    for (const line of ins) {
      // Preserve blank lines for code structure
      if (/^\s*$/.test(line)) {
        out.push('')
        continue
      }

      // Skip full-line comments
      if (isCommentOrWhitespace(line)) {
        continue
      }

      // Keep code lines, stripping any inline comments
      const stripped = stripInlineComment(line)
      out.push(stripped)
    }
  }

  if (out.length === 0) {
    return ''
  }
  return out.join('\n') + ((leftText !== null && leftText !== '') ? (leftText.endsWith('\n') ? '\n' : '') : rightNorm.eol)
}

async function ensureDir(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true })
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const abs = join(root, entry.name)
    if (entry.isDirectory) yield* walkFiles(abs)
    else if (entry.isFile) yield abs
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return null
    }
    throw e
  }
}

export async function processTreesKeepingNonComments(left: string, right: string, log = false): Promise<void> {
  const relPaths = new Set<string>()
  for await (const abs of walkFiles(right)) relPaths.add(abs.slice(right.length + 1))
  for await (const abs of walkFiles(left)) relPaths.add(abs.slice(left.length + 1))

  for (const rel of relPaths) {
    if (rel === 'JJ-INSTRUCTIONS') continue
    const leftPath = join(left, rel)
    const rightPath = join(right, rel)
    const leftTxt = await readFileIfExists(leftPath)
    const rightTxt = await readFileIfExists(rightPath)

    if (rightTxt === null && leftTxt !== null) {
      await ensureDir(dirname(rightPath))
      await Deno.copyFile(leftPath, rightPath)
      if (log) console.error(`[restore-file] ${rel}`)
      continue
    }

    if (leftTxt === null && rightTxt !== null) {
      const { lines, eol } = normalize(rightTxt)
      // For new files: preserve blank lines, remove comments, strip inline comments
      const filtered = lines
        .map((l) => {
          // Preserve blank lines
          if (/^\s*$/.test(l)) return ''
          // Skip full-line comments
          if (isCommentOrWhitespace(l)) return null
          // Strip inline comments from code lines
          return stripInlineComment(l)
        })
        .filter((l) => l !== null)
        .join('\n') + eol
      await ensureDir(dirname(rightPath))
      await Deno.writeTextFile(rightPath, filtered)
      if (log) console.error(`[filter-right-only] ${rel}`)
      continue
    }

    if (leftTxt !== null && rightTxt !== null) {
      const merged = mergeFileKeepingNonComments(leftTxt, rightTxt)
      if (merged !== rightTxt) {
        await Deno.writeTextFile(rightPath, merged)
        if (log) console.error(`[merge] ${rel}`)
      } else {
        if (log) console.error(`[unchanged] ${rel}`)
      }
    }
  }
}

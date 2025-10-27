import { join, dirname } from '@std/path'

export function isCommentOrWhitespace(line: string): boolean {
  return /^\s*(?:\/\/|#)/.test(line) || /^\s*$/.test(line)
}

function equalIgnoringTrailingWhitespace(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd()
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
  const leftNorm = leftText !== null ? normalize(leftText) : { lines: [] as string[], eol: rightText.endsWith('\n') ? '\n' : '' }
  const rightNorm = normalize(rightText)
  const ops = lcs(leftNorm.lines, rightNorm.lines, equalIgnoringTrailingWhitespace)

  const out: string[] = []
  let i = 0, j = 0
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op === 'eq') {
      out.push(leftNorm.lines[i]); i++; j++; k++
      continue
    }

    if (op === 'del' || op === 'ins') {
      const dels: string[] = []
      const ins: string[] = []
      let k2 = k
      while (k2 < ops.length && ops[k2] === 'del') {
        dels.push(leftNorm.lines[i]); i++; k2++
      }
      while (k2 < ops.length && ops[k2] === 'ins') {
        ins.push(rightNorm.lines[j]); j++; k2++
      }

      const insHasNonComment = ins.some((line) => !isCommentOrWhitespace(line))
      if (!insHasNonComment) {
        for (const l of dels) out.push(l)
      } else {
        for (const l of dels) {
          if (isCommentOrWhitespace(l)) out.push(l)
        }
        for (const r of ins) {
          if (!isCommentOrWhitespace(r)) out.push(r)
        }
      }
      k = k2
      continue
    }
  }

  return out.join('\n') + (leftText !== null ? (leftText.endsWith('\n') ? '\n' : '') : rightNorm.eol)
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
      const filtered = lines.filter((l) => !isCommentOrWhitespace(l)).join('\n') + eol
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

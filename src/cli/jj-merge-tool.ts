import { resolve } from '@std/path'
import { processTreesKeepingNonComments } from '../lib/splitNonComment.ts'

function printUsage(): void {
  console.error('Usage: jj-merge-tool <leftDir> <rightDir>')
}

function pathExists(path: string): boolean {
  try {
    Deno.statSync(path)
    return true
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return false
    }
    throw e
  }
}

async function main(): Promise<number> {
  const args = Deno.args
  if (args.length !== 2) {
    printUsage()
    return 2
  }

  const [leftArg, rightArg] = args
  const left = resolve(Deno.cwd(), leftArg)
  const right = resolve(Deno.cwd(), rightArg)

  if (!pathExists(left)) {
    console.error(`Error: left path does not exist: ${left}`)
    return 2
  }
  if (!pathExists(right)) {
    console.error(`Error: right path does not exist: ${right}`)
    return 2
  }

  const [leftStat, rightStat] = await Promise.all([Deno.stat(left), Deno.stat(right)])
  if (!leftStat.isDirectory) {
    console.error(`Error: left path is not a directory: ${left}`)
    return 2
  }
  if (!rightStat.isDirectory) {
    console.error(`Error: right path is not a directory: ${right}`)
    return 2
  }

  const verbose = Deno.env.get('JJ_SPLIT_LOG') === '1' || Deno.env.get('JJ_SPLIT_LOG') === 'true'
  console.log('[jj-merge-tool] Keeping only non-comment changes:')
  console.log(`  left:  ${left}`)
  console.log(`  right: ${right}`)

  await processTreesKeepingNonComments(left, right, verbose)
  return 0
}

main()
  .then((code) => Deno.exit(code))
  .catch((err) => {
    console.error('Unhandled error in jj-merge-tool:', err)
    Deno.exit(1)
  })

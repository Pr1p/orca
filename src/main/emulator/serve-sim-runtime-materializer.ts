import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { dirname, join } from 'node:path'

export type ServeSimRuntimeMaterializerOptions = {
  bundledPackageDir: string
  targetRootDir: string
  version: string
  clearQuarantine?: (dir: string) => void
  ensureLaunchableDuoHelper?: (helperPath: string) => void
}

const DUO_GUEST_HELPER = join('dist', 'simduo', 'serve-sim-duo-hid')
const DYLD_ENV_ENTITLEMENT = 'com.apple.security.cs.allow-dyld-environment-variables'

export type CodesignRunner = (args: string[]) => { status: number | null; output: string }

// Why one call site: keeps this file's sync-spawn ratchet count at its baseline.
function runCLIToolSync(
  program: string,
  args: string[]
): { status: number | null; output: string } {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 30_000 })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function runCodesignSync(args: string[]): { status: number | null; output: string } {
  return runCLIToolSync('/usr/bin/codesign', args)
}

// codesign prints entitlements as [Key]/[Value] pairs or as XML; only the value
// directly after the key counts.
function allowsDyldEnvironment(codesignOutput: string): boolean {
  const at = codesignOutput.indexOf(DYLD_ENV_ENTITLEMENT)
  if (at === -1) {
    return false
  }
  const value = /^\s*(?:\[Value\]\s*\[Bool\]\s*(\w+)|<\/key>\s*<(\w+)\s*\/>)/.exec(
    codesignOutput.slice(at + DYLD_ENV_ENTITLEMENT.length)
  )
  return (value?.[1] ?? value?.[2]) === 'true'
}

// Why: simctl spawn passes DYLD_ROOT_PATH to the guest helper, but a hardened-runtime
// signature without the dyld-environment entitlement makes dyld drop it (#40509).
function signatureDropsDyldEnvironment(codesignOutput: string): boolean {
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/i.exec(codesignOutput)?.[1]?.split(',') ?? []
  return flags.includes('runtime') && !allowsDyldEnvironment(codesignOutput)
}

/** Ad-hoc re-signs the staging copy when its signature would strip DYLD_* variables. Never throws. */
export function ensureLaunchableDuoHelper(
  helperPath: string,
  runCodesign: CodesignRunner = runCodesignSync
): void {
  try {
    const probe = runCodesign(['-d', '--verbose=2', '--entitlements', '-', helperPath])
    if (probe.status !== 0 || !signatureDropsDyldEnvironment(probe.output)) {
      return
    }
    runCodesign(['--force', '--sign', '-', helperPath])
  } catch {
    // A signature we cannot fix must not fail materialization.
  }
}

function defaultEnsureLaunchableDuoHelper(helperPath: string): void {
  if (process.platform !== 'darwin') {
    return
  }
  ensureLaunchableDuoHelper(helperPath)
}

function defaultClearQuarantine(dir: string): void {
  if (process.platform !== 'darwin') {
    return
  }
  // Clear only quarantine: copied simulator dylibs have no Gatekeeper ticket, but other xattrs must survive.
  const { status } = runCLIToolSync('/usr/bin/xattr', ['-rd', 'com.apple.quarantine', dir])
  if (status !== 0) {
    throw new Error(`clearing quarantine failed with status ${String(status)}`)
  }
}

function pruneStaleServeSimRuntimes(targetRootDir: string, keepVersion: string): void {
  let entries: string[]
  try {
    entries = readdirSync(targetRootDir)
  } catch {
    return
  }
  for (const entryName of entries) {
    if (entryName === keepVersion) {
      continue
    }
    try {
      rmSync(join(targetRootDir, entryName), { recursive: true, force: true })
    } catch {
      // Old-version cleanup is best-effort; a locked file must not block materialization.
    }
  }
}

function readDependencyNames(packageDir: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  if (!manifest || typeof manifest !== 'object' || !('dependencies' in manifest)) {
    return []
  }
  const { dependencies } = manifest
  return dependencies && typeof dependencies === 'object' ? Object.keys(dependencies) : []
}

// Link bare imports to bundled dependencies; moved bundles make existing links stale.
function bundledDependencyLinks(
  bundledPackageDir: string,
  runtimeNodeModulesDir: string
): { linkPath: string; targetPath: string }[] {
  const bundledNodeModulesDir = dirname(realpathSync(bundledPackageDir))
  return readDependencyNames(bundledPackageDir)
    .map((name) => ({
      linkPath: join(runtimeNodeModulesDir, name),
      targetPath: join(bundledNodeModulesDir, name)
    }))
    .filter(({ targetPath }) => existsSync(targetPath))
}

function isMaterializedRuntimeCurrent(bundledPackageDir: string, versionDir: string): boolean {
  const nodeModulesDir = join(versionDir, 'node_modules')
  if (!existsSync(join(nodeModulesDir, 'serve-sim', 'dist', 'serve-sim.js'))) {
    return false
  }
  try {
    return bundledDependencyLinks(bundledPackageDir, nodeModulesDir).every(
      ({ linkPath, targetPath }) => realpathSync(linkPath) === realpathSync(targetPath)
    )
  } catch {
    return false
  }
}

// Relocate the whole package for relative helper/dylib paths while preserving the signed bundle.
export function materializeServeSimRuntime(
  options: ServeSimRuntimeMaterializerOptions
): string | null {
  const { bundledPackageDir, targetRootDir, version } = options
  const clearQuarantine = options.clearQuarantine ?? defaultClearQuarantine
  const ensureLaunchableDuoHelperStep =
    options.ensureLaunchableDuoHelper ?? defaultEnsureLaunchableDuoHelper
  const targetDir = join(targetRootDir, version)
  const packageDir = join(targetDir, 'node_modules', 'serve-sim')
  if (isMaterializedRuntimeCurrent(bundledPackageDir, targetDir)) {
    return packageDir
  }
  const stagingDir = join(targetRootDir, `.staging-${version}-${process.pid}`)
  const stagingNodeModulesDir = join(stagingDir, 'node_modules')
  try {
    mkdirSync(targetRootDir, { recursive: true })
    pruneStaleServeSimRuntimes(targetRootDir, version)
    rmSync(stagingDir, { recursive: true, force: true })
    rmSync(targetDir, { recursive: true, force: true })
    const stagingPackageDir = join(stagingNodeModulesDir, 'serve-sim')
    // Why realpath: cpSync copies a symlinked package dir (pnpm layout) as a link back into the bundle.
    cpSync(realpathSync(bundledPackageDir), stagingPackageDir, { recursive: true })
    // Why before linking: the recursive xattr walk must not reach into the signed bundle.
    clearQuarantine(stagingPackageDir)
    // Why unguarded: the codesign probe no-ops when the helper is absent.
    ensureLaunchableDuoHelperStep(join(stagingPackageDir, DUO_GUEST_HELPER))
    for (const { linkPath, targetPath } of bundledDependencyLinks(
      bundledPackageDir,
      stagingNodeModulesDir
    )) {
      mkdirSync(dirname(linkPath), { recursive: true })
      symlinkSync(targetPath, linkPath, 'junction')
    }
    try {
      renameSync(stagingDir, targetDir)
    } catch (error) {
      // Another app instance sharing userData may have finished first.
      if (!isMaterializedRuntimeCurrent(bundledPackageDir, targetDir)) {
        throw error
      }
    }
    return isMaterializedRuntimeCurrent(bundledPackageDir, targetDir) ? packageDir : null
  } catch {
    return null
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

// PTY and structured children must reach this app's CLI regardless of global registration.
import { delimiter, dirname, join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { readInheritedPath } from '../ipc/pty/host-env/path'
import { resolvePathEnvKey } from '../pty/windows-environment-path'
import { ensureLinuxTerminalOrcaCliShimDir } from './linux-terminal-orca-cli-shim'
import { getBundledLauncherPath } from './bundled-cli-launcher-path'
import { DEV_COMMAND_NAME } from './cli-install-constants'

export type OrcaCliChildPathOptions = {
  isPackaged: boolean
  userDataPath: string
  resourcesPath?: string | null
  /** Keeps the user's PATH precedence while still making the Orca launcher discoverable. */
  pathPlacement?: 'append' | 'prepend'
  /** Test seam — production reads the real platform, which is what every branch below assumes. */
  platform?: NodeJS.Platform
}

/** Return the launcher path so children can bypass login shells that reorder PATH; null if unavailable. */
function placeCliDirOnPath(
  cliDir: string,
  inheritedPath: string,
  pathDelimiter: string,
  placement: 'append' | 'prepend'
): string {
  const inheritedEntries = inheritedPath
    .split(pathDelimiter)
    .filter((entry) => entry.length > 0 && entry !== cliDir)
  return (
    placement === 'append' ? [...inheritedEntries, cliDir] : [cliDir, ...inheritedEntries]
  ).join(pathDelimiter)
}

/**
 * Mutates `env` in place, placing the directory that makes bare `orca` this app's CLI. Returns
 * the absolute launcher in that directory, or null when none was placed: a child whose shell
 * rebuilds PATH (a login shell reordering it behind a global install) can still name this app's
 * CLI by path.
 */
export function prependOrcaCliDirToChildPath(
  env: Record<string, string>,
  opts: OrcaCliChildPathOptions
): string | null {
  const platform = opts.platform ?? process.platform
  const pathPlacement = opts.pathPlacement ?? 'prepend'
  delete env.ORCA_CLI_BIN_DIR
  // Honor injected Windows platforms when tests run on another host.
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  const hostLauncher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  if (hostLauncher) {
    const binDir = dirname(hostLauncher)
    env[resolvePathEnvKey(env, platform)] = placeCliDirOnPath(
      binDir,
      readInheritedPath(env, platform),
      pathDelimiter,
      pathPlacement
    )
    if (platform !== 'win32' && pathPlacement === 'prepend') {
      env.ORCA_CLI_BIN_DIR = binDir
    }
    env.ORCA_USER_DATA_PATH = opts.userDataPath
    env.ORCA_CLI_COMMAND = hostLauncher
    return hostLauncher
  }
  // Development children must reach their build rather than a globally installed release.
  if (!opts.isPackaged) {
    const devCliBin = join(opts.userDataPath, 'cli', 'bin')
    if (platform !== 'win32') {
      env.ORCA_CLI_BIN_DIR = devCliBin
    }
    const inheritedPath = readInheritedPath(env, platform)
    // Empty PATH segments can execute commands from cwd; avoid a trailing delimiter.
    env[resolvePathEnvKey(env, platform)] = inheritedPath
      ? `${devCliBin}${pathDelimiter}${inheritedPath}`
      : devCliBin
    return join(devCliBin, platform === 'win32' ? `${DEV_COMMAND_NAME}.cmd` : DEV_COMMAND_NAME)
  } else if (platform === 'linux') {
    // Managed children need bare `orca` to reach the CLI instead of GNOME's screen reader.
    const shimDir = ensureLinuxTerminalOrcaCliShimDir({ userDataPath: opts.userDataPath })
    if (shimDir) {
      env.ORCA_CLI_BIN_DIR = shimDir
      const inheritedEntries = readInheritedPath(env, platform)
        .split(pathDelimiter)
        .filter((entry) => entry.length > 0 && entry !== shimDir)
      env.PATH = [shimDir, ...inheritedEntries].join(pathDelimiter)
      return join(shimDir, 'orca')
    }
  } else if (opts.resourcesPath && (platform === 'darwin' || platform === 'win32')) {
    const bundledCliBin = join(opts.resourcesPath, 'bin')
    if (platform === 'darwin' && pathPlacement === 'prepend') {
      env.ORCA_CLI_BIN_DIR = bundledCliBin
    }
    env[resolvePathEnvKey(env, platform)] = placeCliDirOnPath(
      bundledCliBin,
      readInheritedPath(env, platform),
      pathDelimiter,
      pathPlacement
    )
    // Why the native launcher on Windows: `orca.cmd` refuses message bodies cmd.exe would mangle.
    return getBundledLauncherPath(platform, opts.resourcesPath)
  }
  return null
}

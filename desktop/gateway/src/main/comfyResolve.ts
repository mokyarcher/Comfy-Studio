import { existsSync } from 'fs'
import { join } from 'path'

export type ComfyInstallKind = 'source' | 'portable'

export interface ResolvedComfyInstall {
  kind: ComfyInstallKind
  /** Directory to use as process cwd */
  cwd: string
  /** Directory that contains main.py */
  mainPyDir: string
  defaultLaunch: string
}

const SOURCE_DEFAULT =
  '.venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188'

function portablePythonRel(cwd: string): string {
  if (existsSync(join(cwd, 'python_embeded', 'python.exe'))) {
    return 'python_embeded\\python.exe'
  }
  return 'python_embedded\\python.exe'
}

function portableDefaultLaunch(cwd: string): string {
  const py = portablePythonRel(cwd)
  return `${py} -s ComfyUI\\main.py --windows-standalone-build --enable-manager --listen 127.0.0.1 --port 8188`
}

function isPortableRoot(dir: string): boolean {
  if (!existsSync(join(dir, 'ComfyUI', 'main.py'))) return false
  return (
    existsSync(join(dir, 'python_embeded', 'python.exe')) ||
    existsSync(join(dir, 'python_embedded', 'python.exe'))
  )
}

function asPortable(cwd: string): ResolvedComfyInstall {
  return {
    kind: 'portable',
    cwd,
    mainPyDir: join(cwd, 'ComfyUI'),
    defaultLaunch: portableDefaultLaunch(cwd)
  }
}

function asSource(cwd: string): ResolvedComfyInstall {
  return {
    kind: 'source',
    cwd,
    mainPyDir: cwd,
    defaultLaunch: SOURCE_DEFAULT
  }
}

/**
 * Accept desktop/source ComfyUI (folder with main.py) or Windows portable layouts:
 * - …\ComfyUI_windows_portable  (python_embeded + ComfyUI\main.py)
 * - …\ComfyUI_windows_portable_nvidia  (outer zip folder containing the above)
 */
export function resolveComfyInstall(rawDir: string): ResolvedComfyInstall | null {
  const dir = rawDir.trim()
  if (!dir || !existsSync(dir)) return null

  const nestedPortable = join(dir, 'ComfyUI_windows_portable')
  if (isPortableRoot(nestedPortable)) return asPortable(nestedPortable)
  if (isPortableRoot(dir)) return asPortable(dir)

  if (existsSync(join(dir, 'main.py'))) return asSource(dir)

  const nestedSource = join(dir, 'ComfyUI')
  if (existsSync(join(nestedSource, 'main.py'))) return asSource(nestedSource)

  return null
}

function looksLikeSourceLaunch(launch: string): boolean {
  return /(?:^|[\\/])\.venv[\\/]Scripts[\\/]python(?:\.exe)?\b/i.test(launch) ||
    /\bmain\.py\b/i.test(launch) && !/[\\/]ComfyUI[\\/]main\.py\b/i.test(launch)
}

function looksLikePortableLaunch(launch: string): boolean {
  return (
    /python_embede?d[\\/]python(?:\.exe)?/i.test(launch) ||
    /run_nvidia_gpu(?:_fast[^\\/]*)?\.bat\b/i.test(launch) ||
    /[\\/]ComfyUI[\\/]main\.py\b/i.test(launch)
  )
}

/**
 * Pick an effective launch command for the resolved install.
 * Rewrites obvious desktop↔portable mismatches; keeps custom commands otherwise.
 */
export function resolveComfyLaunch(
  install: ResolvedComfyInstall,
  configuredLaunch: string
): { launch: string; rewrittenFrom?: string } {
  const trimmed = (configuredLaunch || '').trim()
  if (!trimmed) {
    return { launch: install.defaultLaunch, rewrittenFrom: '(empty)' }
  }

  if (install.kind === 'portable' && looksLikeSourceLaunch(trimmed) && !looksLikePortableLaunch(trimmed)) {
    return { launch: install.defaultLaunch, rewrittenFrom: trimmed }
  }
  // Official portable bats end with `pause`; prefer embeded python so Gateway can track exit.
  if (install.kind === 'portable' && /run_nvidia_gpu(?:_fast[^\\/]*)?\.bat\b/i.test(trimmed)) {
    return { launch: install.defaultLaunch, rewrittenFrom: trimmed }
  }
  if (
    install.kind === 'source' &&
    (/python_embede?d/i.test(trimmed) || /run_nvidia_gpu/i.test(trimmed))
  ) {
    return { launch: install.defaultLaunch, rewrittenFrom: trimmed }
  }

  // Portable: bare python → embeded interpreter
  if (install.kind === 'portable' && /^(python|python\.exe|py)(\s|$)/i.test(trimmed)) {
    const absPy = existsSync(join(install.cwd, 'python_embeded', 'python.exe'))
      ? join(install.cwd, 'python_embeded', 'python.exe')
      : join(install.cwd, 'python_embedded', 'python.exe')
    const fixed = trimmed.replace(/^(python|python\.exe|py)\b/i, `"${absPy}"`)
    return { launch: fixed, rewrittenFrom: trimmed }
  }

  // Source: bare python → .venv (caller may also do this; keep consistent)
  if (install.kind === 'source' && /^(python|python\.exe|py)(\s|$)/i.test(trimmed)) {
    const venvPy = join(install.cwd, '.venv', 'Scripts', 'python.exe')
    if (existsSync(venvPy)) {
      const fixed = trimmed.replace(/^(python|python\.exe|py)\b/i, `"${venvPy}"`)
      return { launch: fixed, rewrittenFrom: trimmed }
    }
  }

  return { launch: trimmed }
}

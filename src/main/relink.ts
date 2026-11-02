export interface FolderPath {
  id: string
  path: string
}

/**
 * The library folder that contains `file`, or undefined. Matching is by whole path segments (`C:\Music` does not own
 * `C:\Music2\x.mp3`), case-insensitive on Windows, case-sensitive elsewhere; the deepest folder wins.
 */
export function ownerFolder<F extends FolderPath>(file: string, folders: F[], platform: string): F | undefined {
  const win = platform === 'win32'
  const sep = win ? '\\' : '/'
  const norm = (p: string): string => (win ? p.toLowerCase() : p)
  const target = norm(file)
  return folders
    .filter((f) => target.startsWith(norm(f.path.endsWith(sep) ? f.path : f.path + sep)))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

/** Turns SQLite's duplicate-path error into a message fit for a toast. */
export function relinkError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  return /UNIQUE constraint failed: tracks\.path/.test(msg) ? new Error('That file is already in your library as another track.') : err instanceof Error ? err : new Error(msg)
}

/**
 * Vega icon set: 24px grid, 1.75 stroke, round caps. Filled glyphs (play, pause, heart-fill, ...) set `fill`.
 * Paths are simple geometry authored for this app.
 */
interface Def {
  d: string
  fill?: boolean
  /** extra circles [cx, cy, r] */
  c?: [number, number, number][]
}

const I: Record<string, Def> = {
  home: { d: 'M3.5 10.8 12 3.5l8.5 7.3V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5.5h-6v5.5H5A1.5 1.5 0 0 1 3.5 19z' },
  search: { d: 'm20.5 20.5-4.2-4.2', c: [[11, 11, 6.8]] },
  library: { d: 'M5 4v16M10 4v16M15.2 5.4l4.1 14.4' },
  stats: { d: 'M5 20v-9M12 20V4M19 20v-6' },
  folder: { d: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z' },
  plus: { d: 'M12 5v14M5 12h14' },
  download: { d: 'M12 4v11m0 0-4-4m4 4 4-4M5 19.5h14' },
  upload: { d: 'M12 20V9m0 0-4 4m4-4 4 4M5 4.5h14' },
  check: { d: 'm5 12.5 4.5 4.5L19 7.5' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  play: { d: 'M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z', fill: true },
  pause: { d: 'M7.5 4.5h3.2v15H7.5zM13.3 4.5h3.2v15h-3.2z', fill: true },
  next: { d: 'M6 5.2v13.6a.9.9 0 0 0 1.4.75l9.2-6.8a.9.9 0 0 0 0-1.5L7.4 4.45A.9.9 0 0 0 6 5.2zM18.5 5v14', fill: true },
  prev: { d: 'M18 5.2v13.6a.9.9 0 0 1-1.4.75l-9.2-6.8a.9.9 0 0 1 0-1.5l9.2-6.8A.9.9 0 0 1 18 5.2zM5.5 5v14', fill: true },
  shuffle: { d: 'M16.5 3.5h4v4M3.5 20 20.5 3.5M20.5 16.5v4h-4M14.5 14.5l6 6M3.5 4l5.5 5.5' },
  repeat: { d: 'M17 2.5 20.5 6 17 9.5M3.5 11V9A3 3 0 0 1 6.5 6h14M7 21.5 3.5 18 7 14.5M20.5 13v2a3 3 0 0 1-3 3h-14' },
  'repeat-one': { d: 'M17 2.5 20.5 6 17 9.5M3.5 11V9A3 3 0 0 1 6.5 6h14M7 21.5 3.5 18 7 14.5M20.5 13v2a3 3 0 0 1-3 3h-14M11 10.5l1.2-1v6' },
  heart: { d: 'M12 20.2s-8.2-4.8-8.2-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.2 2.2c0 5.6-8.2 10.4-8.2 10.4z' },
  'heart-fill': { d: 'M12 20.2s-8.2-4.8-8.2-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.2 2.2c0 5.6-8.2 10.4-8.2 10.4z', fill: true },
  more: { d: '', c: [[5.5, 12, 1.3], [12, 12, 1.3], [18.5, 12, 1.3]] },
  queue: { d: 'M3.5 6h12M3.5 12h12M3.5 18h7M18 14.5l3.5 2.5-3.5 2.5z' },
  mic: { d: 'M12 3.2a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.2a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.3' },
  lyrics: { d: 'M4 6h10M4 11h7M4 16h5M17 5.5v9.2a2.4 2.4 0 1 1-1.6-2.3V7.5l5-1.4' },
  volume: { d: 'M4 9.5v5h3.6L12.5 19V5L7.6 9.5zM16 9a4.2 4.2 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2' },
  'volume-mute': { d: 'M4 9.5v5h3.6L12.5 19V5L7.6 9.5zM16.5 9.5l5 5M21.5 9.5l-5 5' },
  eq: { d: 'M5 20.5v-6M5 10.5v-7M12 20.5v-9M12 7.5v-4M19 20.5v-4M19 12.5v-9M2.5 14h5M9.5 7.5h5M16.5 16h5' },
  radio: { d: 'M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.6 15.4a4.7 4.7 0 0 1 0-6.8M15.4 8.6a4.7 4.7 0 0 1 0 6.8', c: [[12, 12, 1.5]] },
  spark: { d: 'M12 3.5l2.1 5.4 5.4 2.1-5.4 2.1L12 18.5l-2.1-5.4L4.5 11l5.4-2.1z' },
  star: { d: 'M12 3.4l2.5 5.6 6.1.6-4.6 4.1 1.4 6-5.4-3.2-5.4 3.2 1.4-6-4.6-4.1 6.1-.6z' },
  'chevron-left': { d: 'm14.5 5-7 7 7 7' },
  'chevron-right': { d: 'm9.5 5 7 7-7 7' },
  'chevron-down': { d: 'm5 9.5 7 7 7-7' },
  command: { d: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z' },
  expand: { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' },
  clock: { d: 'M12 7.5V12l3 2', c: [[12, 12, 8.5]] },
  user: { d: 'M4.5 20a7.5 7.5 0 0 1 15 0', c: [[12, 8, 3.6]] },
  cloud: { d: 'M7.5 18.5a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.6 8.7 4.9 4.9 0 0 1 17 18.5z' },
  trash: { d: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5' },
  note: { d: 'M9 17.5V5.5l10-2v12M9 17.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 17.5zM19 15.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5z' },
  disc: { d: '', c: [[12, 12, 8.5], [12, 12, 2.2]] },
  globe: { d: 'M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5S14.6 18.1 12 20.5M12 3.5C9.4 5.9 8.1 8.7 8.1 12s1.3 6.1 3.9 8.5', c: [[12, 12, 8.5]] },
  settings: { d: 'M4 7h9M17 7h3M4 17h3M11 17h9', c: [[15, 7, 2], [9, 17, 2]] },
  external: { d: 'M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H10' },
  grid: { d: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z' },
  list: { d: 'M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01' }
}

export function Icon({ name, size = 20, strokeWidth = 1.75 }: { name: string; size?: number; strokeWidth?: number }) {
  const def = I[name]
  if (!def) return null
  const fill = def.fill ? 'currentColor' : 'none'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={def.fill ? 1.2 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {def.d && <path d={def.d} />}
      {def.c?.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill={name === 'more' ? 'currentColor' : 'none'} />
      ))}
    </svg>
  )
}

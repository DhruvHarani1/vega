import { useEffect, useRef } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import './store/auth' // starts session restore and background sync
import { CommandPalette } from './components/CommandPalette'
import { EqPanel } from './components/EqPanel'
import { initAndroidBridge } from './lib/androidBridge'
import { warmAudioOutput } from './lib/audioWarmup'
import { resumeEq } from './lib/eq'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { useArtTheme } from './lib/artTheme'
import { useCatalog } from './store/catalog'
import { useLibrary } from './store/library'
import { useMeta } from './store/meta'
import { usePlayer } from './store/player'
import { useUi } from './store/ui'
import { Account } from './views/Account'
import { Home } from './views/Home'
import { Library } from './views/Library'
import { LyraPlayer } from './views/LyraPlayer'
import { PlaylistView } from './views/PlaylistView'
import { Radio } from './views/Radio'
import { Search } from './views/Search'
import { Settings } from './views/Settings'
import { SmartView } from './views/SmartView'
import { Sources } from './views/Sources'
import { Stats } from './views/Stats'

export function App() {
  const view = useUi((s) => s.view)
  const panel = useUi((s) => s.panel)
  const nowPlaying = useUi((s) => s.nowPlaying)
  const commandOpen = useUi((s) => s.commandOpen)
  const eqOpen = useUi((s) => s.eqOpen)
  const main = useRef<HTMLElement>(null)
  useArtTheme()

  // a saved "EQ on" needs a user gesture before the audio context may start
  useEffect(() => {
    const once = (): void => resumeEq()
    window.addEventListener('pointerdown', once, { once: true })
    return () => window.removeEventListener('pointerdown', once)
  }, [])

  useEffect(() => {
    void useCatalog.getState().refresh()
    warmAudioOutput()
    initAndroidBridge()
  }, [])

  // Background enrichment: learn genres for artists we know nothing about (1 request/s, cached).
  const catalog = useCatalog((s) => s.tracks)
  const events = useLibrary((s) => s.events)
  const liked = useLibrary((s) => s.liked)
  useEffect(() => {
    const t = setTimeout(() => useMeta.getState().request([...liked, ...events.slice(-200).map((e) => e.track), ...catalog.slice(0, 300)]), 1500)
    return () => clearTimeout(t)
  }, [catalog, events, liked])

  // new page => back to the top
  const viewKey = JSON.stringify(view)
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [viewKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && (t as HTMLInputElement).type !== 'range'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUi.getState().setCommandOpen(!useUi.getState().commandOpen)
        return
      }
      if (typing) return
      if (e.code === 'Space') {
        e.preventDefault()
        usePlayer.getState().togglePlay()
      } else if (e.code === 'ArrowRight' && e.ctrlKey) usePlayer.getState().next()
      else if (e.code === 'ArrowLeft' && e.ctrlKey) usePlayer.getState().prev()
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && usePlayer.getState().queue.length) useUi.getState().togglePanel('lyrics')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app${panel ? ' with-drawer' : ''}${panel === 'lyrics' ? ' wide-drawer' : ''}`}>
      <div className="ambient" aria-hidden>
        <div className="aurora">
          <i />
          <i />
          <i />
        </div>
        <div className="grain" />
      </div>
      <Sidebar />
      <section className="stage">
        <TopBar />
        <main className="main" ref={main}>
          <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={viewKey} className="page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
              {view.name === 'home' && <Home />}
              {view.name === 'search' && <Search />}
              {view.name === 'library' && <Library />}
              {view.name === 'radio' && <Radio />}
              {view.name === 'stats' && <Stats />}
              {view.name === 'sources' && <Sources />}
              {view.name === 'account' && <Account />}
              {view.name === 'settings' && <Settings />}
              {view.name === 'playlist' && <PlaylistView id={view.id} />}
              {view.name === 'smart' && <SmartView id={view.id} key={view.id} />}
            </motion.div>
          </AnimatePresence>
          </MotionConfig>
        </main>
      </section>
      {panel && <QueuePanel />}
      <PlayerBar />
      {commandOpen && <CommandPalette />}
      {eqOpen && window.vega && <EqPanel />}
      {nowPlaying && <LyraPlayer />}
      <Toasts />
    </div>
  )
}

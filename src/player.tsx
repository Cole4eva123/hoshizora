import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Player from '@/pages/Player'

// The player's window (player.html), apart from the app's pages: no router, no TMDB, no Emby.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Player />
  </StrictMode>,
)

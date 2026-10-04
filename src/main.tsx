import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import '@fontsource/noto-serif-sc/900.css'
import './index.css'
import App from '@/App'
import Category from '@/pages/Category'
import Detail from '@/pages/Detail'
import Favorites from '@/pages/Favorites'
import Home from '@/pages/Home'
import Library from '@/pages/Library'
import Person from '@/pages/Person'
import Search from '@/pages/Search'
import Settings from '@/pages/Settings'

const router = createBrowserRouter(
  [
    {
      element: <App />,
      children: [
        { index: true, element: <Home /> },
        { path: 'category/:key', element: <Category /> },
        { path: 'movie/:id', element: <Detail type="movie" /> },
        { path: 'tv/:id', element: <Detail type="tv" /> },
        { path: 'person/:id', element: <Person /> },
        { path: 'favorites', element: <Favorites /> },
        { path: 'library', element: <Library /> },
        { path: 'search', element: <Search /> },
        { path: 'settings', element: <Settings /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

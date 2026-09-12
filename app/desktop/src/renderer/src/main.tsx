import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './AppErrorBoundary'
import { MotionProvider } from './motion'
import { FullScreenExit } from './FullScreenExit'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FullScreenExit />
    <AppErrorBoundary>
      <MotionProvider><App /></MotionProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)

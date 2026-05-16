// MUST be first: sets window.CESIUM_BASE_URL before any cesium module
// evaluates (App's tree imports cesium). See cesiumBaseUrl.ts.
import './cesiumBaseUrl'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

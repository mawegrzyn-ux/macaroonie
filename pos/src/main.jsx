import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { startAppUpdates } from './lib/appUpdate.js'
import './index.css'

// Kiosk design previews (inside the admin, and shared ones) and the kitchen test bench keep
// whatever copy they opened with.
const QUERY = new URLSearchParams(location.search)
if (!QUERY.get('kiosk_preview') && !QUERY.get('kiosk_share') && !QUERY.get('kitchen_test')) startAppUpdates()

ReactDOM.createRoot(document.getElementById('root')).render(<App />)

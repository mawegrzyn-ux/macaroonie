// The kiosk in demo mode (macaroonie.com/try/kiosk; build vite.demo.config.js,
// entry demo-kiosk.html): the same kiosk app, framed by the kiosk designer
// demo, which sends it the demo menu and the visitor's design
// (../demoSource.js). No pairing, no service worker, no API.

import React from 'react'
import ReactDOM from 'react-dom/client'
import KioskApp from '../KioskApp.jsx'
import '../../index.css'

ReactDOM.createRoot(document.getElementById('root')).render(<KioskApp demo />)

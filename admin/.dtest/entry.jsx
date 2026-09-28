import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/index.css'
import MenuDesigner from '@/pages/MenuDesigner'
ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/menus/m1/design']}>
      <div style={{ height: '100vh' }}><Routes><Route path="/menus/:id/design" element={<MenuDesigner />} /></Routes></div>
    </MemoryRouter>
  </QueryClientProvider>
)

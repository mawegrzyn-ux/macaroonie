// src/components/PageErrorBoundary.jsx
//
// Catches a crash while a page renders and shows what went wrong, with a
// reload button, instead of leaving the whole admin blank. Mounted around
// the page outlet in AppShell and MobileShell, keyed by the path, so moving
// to another page clears it. The error also goes to the console with the
// component stack.

import { Component } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const message = String(error?.message || error || 'Unknown error')
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-xl mx-auto p-6">
          <div className="rounded-xl border bg-background p-5 space-y-3">
            <p className="font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5 shrink-0" /> This page stopped working
            </p>
            <p className="text-sm text-muted-foreground">
              Something on the page failed while it was being shown. Nothing you saved before this is lost.
              Reload to try again. If it keeps happening, send this message to support:
            </p>
            <pre className="text-xs whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2">{message}</pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[48px] px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 touch-manipulation"
            >
              <RotateCw className="w-4 h-4" /> Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}

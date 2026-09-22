import { useEffect, useRef } from 'react'

// Marks the one history entry that stands for "something is open on top of the task list".
const OVERLAY_KEY = 'taskstrideOverlay'

function overlayEntryIsCurrent(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[OVERLAY_KEY])
}

/**
 * Makes the browser's Back button (and Android's system Back) close whatever is open instead of
 * leaving the app.
 *
 * `layers` lists what is open, topmost first. However many layers are open, exactly one history
 * entry represents them: Back closes the topmost layer and, if others remain, adds the entry
 * again. Layers can therefore open and close in any order without stranding entries that would
 * make a later Back press appear to do nothing. When the last layer is closed from the UI, the
 * entry is consumed so the next Back behaves normally.
 */
export function useBackClosesLayers<Layer extends string>(layers: Layer[], close: (layer: Layer) => void) {
  const latest = useRef({ layers, close })
  const consuming = useRef(false)
  useEffect(() => { latest.current = { layers, close } })

  const open = layers.length > 0
  useEffect(() => {
    const marked = overlayEntryIsCurrent(window.history.state)
    if (open && !marked) {
      window.history.pushState({ ...(window.history.state ?? {}), [OVERLAY_KEY]: true }, '')
    } else if (!open && marked && !consuming.current) {
      // Also clears an entry left behind by a reload while something was open.
      consuming.current = true
      window.history.back()
    }
  }, [open])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (overlayEntryIsCurrent(event.state)) return
      const reopen = () => window.history.pushState({ ...(event.state ?? {}), [OVERLAY_KEY]: true }, '')
      if (consuming.current) {
        // Our own clean-up finished. Something may have opened while it was in flight.
        consuming.current = false
        if (latest.current.layers.length) reopen()
        return
      }
      const [top, ...rest] = latest.current.layers
      if (!top) return
      latest.current.close(top)
      if (rest.length) reopen()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
}

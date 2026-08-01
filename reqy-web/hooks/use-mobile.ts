import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile(maxWidth = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState(true)

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const onChange = () => {
      setIsMobile(mediaQuery.matches)
    }
    mediaQuery.addEventListener('change', onChange)
    const mobileTimeout = window.setTimeout(() => setIsMobile(mediaQuery.matches), 0)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
      if (mobileTimeout) window.clearTimeout(mobileTimeout)
    }
  }, [maxWidth])

  return !!isMobile
}

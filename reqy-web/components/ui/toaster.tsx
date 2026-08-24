'use client'

import { useToast } from '@/hooks/use-toast'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const toastIcons = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle,
  warning: AlertTriangle,
} as const

export function Toaster() {
  const { toasts, remove } = useToast()
  const [mounted, setMounted] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(t)
  }, [])

  if (!mounted) return null

  // Limiter à 5 visibles dans le stack pour garder le tout propre
  const visibleToasts = toasts.slice(0, 5)

  return createPortal(
    <div
      className="fixed bottom-5 right-5 z-[100] flex w-full max-w-xs flex-col items-end pointer-events-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        // Donner une hauteur minimale au container quand survolé pour éviter les sauts de scroll
        height: isHovered ? `${Math.min(visibleToasts.length, 4) * 88 + 12}px` : '76px',
        transition: 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <div className="relative w-full h-full">
        {visibleToasts.map((t, idx) => {
          const Icon = toastIcons[t.variant as keyof typeof toastIcons] ?? Info

          // Style de positionnement dynamique avec un espacement confortable
          const zIndex = 100 - idx
          const transform = isHovered
            ? `translateY(-${idx * 80}px) scale(1)`
            : idx === 0
            ? 'translateY(0) scale(1)'
            : idx === 1
            ? 'translateY(-10px) scale(0.95)'
            : idx === 2
            ? 'translateY(-20px) scale(0.90)'
            : 'translateY(-30px) scale(0.85)'

          const opacity = isHovered
            ? 1
            : idx === 0
            ? 1
            : idx === 1
            ? 0.9
            : idx === 2
            ? 0.4
            : 0

          const pointerEvents = isHovered || idx === 0 ? 'auto' : 'none'

          return (
          <div
            key={t.id}
            onClick={t.onClick}
            style={{
              zIndex: zIndex,
              transform: transform,
              opacity: opacity,
              pointerEvents: pointerEvents,
              transformOrigin: 'bottom center',
              position: 'absolute',
              bottom: 0,
              right: 0,
            }}
            className={cn(
              'gpu flex w-full max-w-xs items-start gap-3 overflow-hidden rounded-lg border p-3.5 pr-3 shadow-xl',
              t.variant === 'destructive'
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'border bg-background text-foreground',
              t.onClick && 'cursor-pointer',
              'transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1)'
            )}
          >
          {/* Left accent bar */}
          <span className={cn(
            'absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg',
            t.variant === 'destructive' ? 'bg-destructive-foreground/30' : 'bg-primary/40'
          )} />

          <div className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            t.variant === 'destructive' ? 'bg-destructive-foreground/10' : 'bg-primary/10'
          )}>
            <Icon className={cn(
              'size-4',
              t.variant === 'destructive' ? 'text-destructive-foreground/90' : 'text-primary'
            )} />
          </div>

          <div className="flex-1 min-w-0">
            {t.title && <div className="text-sm font-semibold leading-snug">{t.title}</div>}
            {t.description && <div className="mt-1 text-xs leading-relaxed opacity-80">{t.description}</div>}
          </div>
          {t.action && (
            <button
              onClick={(e) => { e.stopPropagation(); t.action?.onClick(); remove(t.id) }}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-all duration-200',
                t.variant === 'destructive'
                  ? 'text-destructive-foreground hover:bg-destructive-foreground/15'
                  : 'text-primary hover:bg-primary/10'
              )}
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); remove(t.id) }}
            className={cn(
              'shrink-0 rounded-md p-1 transition-all duration-200',
              t.variant === 'destructive'
                ? 'text-destructive-foreground/50 hover:text-destructive-foreground hover:bg-destructive-foreground/10'
                : 'text-foreground/30 hover:text-foreground hover:bg-accent'
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )})}
      </div>
    </div>,
    document.body
  )
}

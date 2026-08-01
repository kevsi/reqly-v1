/**
 * Fallback loading UI for any (app)/ route that doesn't have its own loading.tsx.
 * Shows a spinner inside the (app) layout (sidebar + header stay visible).
 */
export default function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  )
}

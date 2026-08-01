import { cn } from "@/lib/utils"

export function AppIcon({ className }: { className?: string }) {
  return (
    <img 
      src="/icon.png" 
      alt="App Icon" 
      className={cn("object-contain", className)} 
    />
  )
}

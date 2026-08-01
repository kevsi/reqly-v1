"use client"
import { Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  onClick: () => void
  disabled?: boolean
}

export function PrettifyButton({ onClick, disabled }: Props) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} data-testid="graphql-prettify-button">
      <Wand2 className="w-3 h-3 mr-1" />
      Prettify
    </Button>
  )
}

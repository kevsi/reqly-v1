"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ThemeCards } from "./theme-cards"
import { AccentPicker } from "./accent-picker"
import { AnimationsToggle } from "./animations-toggle"
export function ApparenceSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Apparence</h2>
        <p className="text-sm text-muted-foreground">
          Personnalisez l'apparence de l'interface selon vos préférences.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <ThemeCards />
          <Separator />
          <AccentPicker />
          <Separator />
          <AnimationsToggle />
        </CardContent>
      </Card>
    </div>
  )
}

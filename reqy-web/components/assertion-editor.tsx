"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import type { Assertion } from "@/lib/test-runner/types"
import { createJsonKeyDownHandler } from "@/lib/json-textarea-utils"

interface Props {
  assertions: Assertion[]
  onChange: (next: Assertion[]) => void
}

export function AssertionEditor({ assertions, onChange }: Props) {
  const add = () => onChange([...assertions, { type: "status", expected: 200 }])
  const remove = (i: number) => onChange(assertions.filter((_, idx) => idx !== i))
  const update = (i: number, a: Assertion) => {
    const next = [...assertions]
    next[i] = a
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Assertions</h4>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>
      {assertions.length === 0 && (
        <p className="text-xs text-muted-foreground">No assertions yet</p>
      )}
      {assertions.map((a, i) => (
        <div key={i} className="flex items-center gap-2 p-2 border rounded">
          <Select value={a.type} onValueChange={(v) => update(i, defaultAssertion(v as Assertion["type"]))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="responseTime">Time</SelectItem>
              <SelectItem value="jsonPath">JSON Path</SelectItem>
              <SelectItem value="schema">Schema</SelectItem>
            </SelectContent>
          </Select>
          <AssertionFields assertion={a} onChange={(next) => update(i, next)} />
          <Button type="button" size="icon" variant="ghost" onClick={() => remove(i)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function defaultAssertion(type: Assertion["type"]): Assertion {
  switch (type) {
    case "status": return { type: "status", expected: 200 }
    case "responseTime": return { type: "responseTime", operator: "<", valueMs: 1000 }
    case "jsonPath": return { type: "jsonPath", path: "$.id", operator: "equals", value: "" }
    case "schema": return { type: "schema", schema: { type: "object" } }
  }
}

function AssertionFields({ assertion, onChange }: { assertion: Assertion; onChange: (a: Assertion) => void }) {
  if (assertion.type === "status") {
    return (
      <Input
        type="number"
        value={typeof assertion.expected === "number" ? assertion.expected : 200}
        onChange={(e) => onChange({ type: "status", expected: Number(e.target.value) })}
        className="w-24"
      />
    )
  }
  if (assertion.type === "responseTime") {
    return (
      <div className="flex items-center gap-1">
        <Select value={assertion.operator} onValueChange={(v) => onChange({ ...assertion, operator: v as "<" | "<=" | ">" | ">=" })}>
          <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="<">&lt;</SelectItem>
            <SelectItem value="<=">&le;</SelectItem>
            <SelectItem value=">">&gt;</SelectItem>
            <SelectItem value=">=">&ge;</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          value={assertion.valueMs}
          onChange={(e) => onChange({ ...assertion, valueMs: Number(e.target.value) })}
          className="w-24"
        />
        <span className="text-xs text-muted-foreground">ms</span>
      </div>
    )
  }
  if (assertion.type === "jsonPath") {
    return (
      <>
        <Input
          placeholder="$.user.id"
          value={assertion.path}
          onChange={(e) => onChange({ ...assertion, path: e.target.value })}
          className="flex-1"
        />
        <Select value={assertion.operator} onValueChange={(v) => onChange({ ...assertion, operator: v as "equals" | "contains" | "exists" | "notExists" })}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="equals">equals</SelectItem>
            <SelectItem value="contains">contains</SelectItem>
            <SelectItem value="exists">exists</SelectItem>
            <SelectItem value="notExists">not exists</SelectItem>
          </SelectContent>
        </Select>
        {assertion.operator !== "exists" && assertion.operator !== "notExists" && (
          <Input
            placeholder="expected"
            value={String(assertion.value ?? "")}
            onChange={(e) => onChange({ ...assertion, value: e.target.value })}
            className="w-32"
          />
        )}
      </>
    )
  }
  if (assertion.type === "schema") {
    return (
      <Input
        placeholder='{ "type": "object" }'
        value={JSON.stringify(assertion.schema)}
        onChange={(e) => {
          try { onChange({ ...assertion, schema: JSON.parse(e.target.value) }) } catch { /* ignore */ }
        }}
        onKeyDown={createJsonKeyDownHandler(JSON.stringify(assertion.schema), (next) => {
          try { onChange({ ...assertion, schema: JSON.parse(next) }) } catch { /* ignore */ }
        })}
        className="flex-1 font-mono text-xs"
      />
    )
  }
  return null
}

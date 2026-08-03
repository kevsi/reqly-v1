"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { proxyAuthHeaders } from "@/lib/proxy-auth"
import { isTauriAvailable } from "@/lib/tauri"
import { callAiProxyTauri } from "@/lib/tauri-ai"
import type { AIProvider } from "@/lib/types"

export interface TestResult {
  success: boolean
  message: string
}

interface TestConnectionParams {
  provider: AIProvider
  apiKey: string
  model: string
  baseUrl: string
  isCustom: boolean
}

export function useTestConnection() {
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const clearTestResult = useCallback(() => setTestResult(null), [])

  const testConnection = useCallback(async (params: TestConnectionParams) => {
    const { provider, apiKey, model, baseUrl, isCustom } = params

    if (!apiKey && provider !== "ollama") return
    if (!model && provider !== "ollama") {
      setTestResult({ success: false, message: "Sélectionnez d'abord un modèle." })
      return
    }

    setTestLoading(true)
    setTestResult(null)

    try {
      const testModel = model || (provider === "ollama" ? "llama2" : undefined)
      if (!testModel) {
        setTestResult({ success: false, message: "Aucun modèle sélectionné." })
        setTestLoading(false)
        return
      }

      const body: Record<string, unknown> = {
        provider,
        apiKey: provider === "ollama" ? "" : apiKey,
        model: testModel,
        message: "Réponds uniquement par 'ok' si tu reçois ce message.",
        system: "Tu es un assistant de test. Réponds uniquement par 'ok'.",
      }

      if (isCustom || provider === "openai") {
        body.openaiUrl = baseUrl
      }

      let res: Response | { status: number; body: string }

      if (isTauriAvailable()) {
        const tauriBody: Record<string, unknown> = {
          provider,
          apiKey: provider === "ollama" ? "" : apiKey,
          model: testModel,
          message: "Réponds uniquement par 'ok' si tu reçois ce message.",
          system: "Tu es un assistant de test. Réponds uniquement par 'ok'.",
        }
        if (isCustom || provider === "openai") tauriBody.openaiUrl = baseUrl
        const { content: text } = await callAiProxyTauri(tauriBody)
        res = { status: 200, body: JSON.stringify({ content: text }) }
      } else {
        res = await fetch("/api/proxy-ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...proxyAuthHeaders(),
          },
          body: JSON.stringify({
            provider,
            apiKey: provider === "ollama" ? "" : apiKey,
            model: testModel,
            message: "Réponds uniquement par 'ok' si tu reçois ce message.",
            system: "Tu es un assistant de test. Réponds uniquement par 'ok'.",
            ...(isCustom || provider === "openai" ? { openaiUrl: baseUrl } : {}),
          }),
        })
      }

      const data = await (res instanceof Response ? res.json().catch(() => ({})) : Promise.resolve({}))

      if (res instanceof Response) {
        if (!res.ok) {
          if (data.code === "PROXY_AUTH_REQUIRED") {
            throw new Error("Authentification du proxy refusée. Vérifie la configuration du token dans .env.local")
          }
          const errMsg = data.error || `HTTP ${res.status}`
          throw new Error(`Clé API ${errMsg.includes("key") ? "" : "invalide"} : ${errMsg}`)
        }

        const content = typeof data.content === "string" ? data.content.trim() : ""
        if (content.toLowerCase().includes("ok")) {
          setTestResult({ success: true, message: "Connexion réussie ! Le modèle répond." })
          toast.success("Test réussi !")
        } else {
          setTestResult({
            success: true,
            message: `Réponse reçue (vérifiez que c'est correct) : "${content.slice(0, 100)}"`,
          })
          toast.success("Réponse reçue du modèle.")
        }
      } else {
        const text = typeof res.body === "string" ? res.body : ""
        if (text.toLowerCase().includes("ok")) {
          setTestResult({ success: true, message: "Connexion réussie ! Le modèle répond." })
          toast.success("Test réussi !")
        } else {
          setTestResult({
            success: true,
            message: `Réponse reçue (vérifiez que c'est correct) : "${text.slice(0, 100)}"`,
          })
          toast.success("Réponse reçue du modèle.")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setTestResult({ success: false, message: `Échec : ${message}` })
      toast.error(`Test échoué : ${message}`)
    } finally {
      setTestLoading(false)
    }
  }, [])

  return { testLoading, testResult, testConnection, clearTestResult }
}

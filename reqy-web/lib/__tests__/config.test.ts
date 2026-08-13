import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadAIProvider,
  saveAIProvider,
  loadApiKey,
  saveApiKey,
  loadOllamaConfig,
  saveOllamaConfig,
  loadAiBaseUrl,
  saveAiBaseUrl,
  loadAiModel,
} from "../config";
import * as persistence from "../persistence";
import * as secureStorage from "../secure-storage";

vi.mock("../persistence", () => ({
  persistence: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

vi.mock("../secure-storage", () => ({
  secureKeys: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AI Provider", () => {
    it("loads default provider when not set", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue(null);
      expect(loadAIProvider()).toBe("openai");
    });

    it("saves and loads AI provider", async () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue("anthropic");
      await saveAIProvider("anthropic");

      expect(persistence.persistence.setItem).toHaveBeenCalledWith(
        "probe_ai_provider",
        "anthropic",
      );
    });

    it("handles getItem error gracefully", () => {
      vi.mocked(persistence.persistence.getItem).mockImplementation(() => {
        throw new Error("Storage error");
      });

      expect(loadAIProvider()).toBe("openai");
    });
  });

  describe("API Key", () => {
    it("loads API key from secure storage", () => {
      vi.mocked(secureStorage.secureKeys.get).mockReturnValue("sk-test-key");
      expect(loadApiKey("openai")).toBe("sk-test-key");
    });

    it("returns empty string when no key", () => {
      vi.mocked(secureStorage.secureKeys.get).mockReturnValue(null);
      expect(loadApiKey("openai")).toBe("");
    });

    it("saves API key to secure storage", () => {
      saveApiKey("openai", "sk-new-key");
      expect(secureStorage.secureKeys.set).toHaveBeenCalledWith(
        "probe_api_keys_openai",
        "sk-new-key",
      );
    });

    it("deletes key when saving empty string", () => {
      saveApiKey("openai", "");
      expect(secureStorage.secureKeys.delete).toHaveBeenCalledWith("probe_api_keys_openai");
    });
  });

  describe("Ollama Config", () => {
    it("loads default config when not set", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue(null);
      const config = loadOllamaConfig();

      expect(config).toEqual({});
    });

    it("loads saved config", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue({
        baseUrl: "http://custom:8080",
        model: "mistral",
      });

      const config = loadOllamaConfig();
      expect(config.baseUrl).toBe("http://custom:8080");
      expect(config.model).toBe("mistral");
    });

    it("saves config", async () => {
      await saveOllamaConfig({
        baseUrl: "http://test:9000",
        model: "codellama",
      });

      expect(persistence.persistence.setItem).toHaveBeenCalledWith("probe_ollama_config", {
        baseUrl: "http://test:9000",
        model: "codellama",
      });
    });
  });

  describe("AI Base URL", () => {
    it("loads empty string when not set", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue(null);
      expect(loadAiBaseUrl("openai")).toBe("");
    });

    it("loads provider-specific base URL", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue({
        openai: "https://api.custom.com",
        anthropic: "https://api.anthropic.custom.com",
      });

      expect(loadAiBaseUrl("openai")).toBe("https://api.custom.com");
      expect(loadAiBaseUrl("anthropic")).toBe("https://api.anthropic.custom.com");
    });

    it("saves base URL for provider", async () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue({});

      await saveAiBaseUrl("openai", "https://custom.api");

      expect(persistence.persistence.setItem).toHaveBeenCalled();
    });
  });

  describe("AI Model", () => {
    it("loads empty string when not set", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue(null);
      expect(loadAiModel("openai")).toBe("");
    });

    it("loads provider-specific model", () => {
      vi.mocked(persistence.persistence.getItem).mockReturnValue({
        openai: "gpt-4",
        anthropic: "claude-3-opus",
      });

      expect(loadAiModel("openai")).toBe("gpt-4");
      expect(loadAiModel("anthropic")).toBe("claude-3-opus");
    });
  });

  describe("error handling", () => {
    it("handles persistence errors in load", () => {
      vi.mocked(persistence.persistence.getItem).mockImplementation(() => {
        throw new Error("Database error");
      });

      expect(() => loadOllamaConfig()).not.toThrow();
      expect(loadAiBaseUrl("openai")).toBe("");
    });

    it("handles persistence errors in save", async () => {
      vi.mocked(persistence.persistence.setItem).mockImplementation(() => {
        throw new Error("Write error");
      });

      await expect(saveAIProvider("anthropic")).resolves.not.toThrow();
    });
  });
});

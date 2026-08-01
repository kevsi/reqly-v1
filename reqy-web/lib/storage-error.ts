/**
 * StorageError — Proper error handling for storage failures
 *
 * Provides error context and recovery information when storage operations fail.
 * Enables proper fallback mechanisms and user notifications.
 */

export interface StorageErrorOptions {
  cause?: Error | unknown;
  context?: Record<string, unknown>;
  recoverable?: boolean;
}

/**
 * Custom error for storage-related failures
 */
export class StorageError extends Error {
  public readonly cause?: Error | unknown;
  public readonly context: Record<string, unknown>;
  public readonly recoverable: boolean;

  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message);
    this.name = "StorageError";
    this.cause = options.cause;
    this.context = options.context || {};
    this.recoverable = options.recoverable !== false;

    // Maintain prototype chain
    Object.setPrototypeOf(this, StorageError.prototype);
  }

  /**
   * Create a StorageError from an unknown error
   */
  static fromUnknown(error: unknown, context?: Record<string, unknown>): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    if (error instanceof Error) {
      let message = error.message;
      let recoverable = true;

      // Analyze error message for recovery hints
      if (message.includes("QuotaExceededError")) {
        message = "Storage quota exceeded. Data may not be saved.";
        recoverable = true; // Can retry after clearing space
      } else if (message.includes("NotAllowedError") || message.includes("Permission denied")) {
        message = "Storage permission denied. Using fallback storage.";
        recoverable = false;
      } else if (message.includes("NotFoundError")) {
        message = "Storage not available. Using fallback.";
        recoverable = true;
      }

      return new StorageError(message, {
        cause: error,
        context,
        recoverable,
      });
    }

    return new StorageError("Unknown storage error", {
      cause: error,
      context,
      recoverable: true,
    });
  }

  /**
   * Check if error indicates the storage adapter is completely unavailable
   */
  isUnavailable(): boolean {
    return !this.recoverable || this.message.includes("not available");
  }

  /**
   * Get a user-friendly error message
   */
  getUserMessage(): string {
    if (this.message.includes("quota")) {
      return "Storage is full. Please clear some data and try again.";
    }
    if (this.message.includes("Permission")) {
      return "Storage access denied. Your data may not be saved.";
    }
    if (this.message.includes("not available")) {
      return "Storage is temporarily unavailable. Using fallback storage.";
    }
    return "Failed to save data. Please check your storage.";
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      recoverable: this.recoverable,
      context: this.context,
    };
  }
}

/**
 * Specific error for IndexedDB operations
 */
export class IndexedDbError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(`[IndexedDB] ${message}`, {
      ...options,
      recoverable: true, // IndexedDB failures can usually fallback to localStorage
    });
    this.name = "IndexedDbError";
    Object.setPrototypeOf(this, IndexedDbError.prototype);
  }
}

/**
 * Specific error for Tauri FS operations
 */
export class TauriError extends StorageError {
  static fromUnknown(error: unknown, context?: Record<string, unknown>): TauriError {
    if (error instanceof TauriError) {
      return error;
    }

    if (error instanceof Error) {
      let message = error.message;
      let recoverable = true;

      if (message.includes("QuotaExceededError")) {
        message = "Storage quota exceeded. Data may not be saved.";
        recoverable = true;
      } else if (message.includes("NotAllowedError") || message.includes("Permission denied")) {
        message = "Storage permission denied. Using fallback storage.";
        recoverable = false;
      } else if (message.includes("NotFoundError")) {
        message = "Storage not available. Using fallback.";
        recoverable = true;
      }

      return new TauriError(message, {
        cause: error,
        context,
        recoverable,
      });
    }

    return new TauriError("Unknown storage error", {
      cause: error,
      context,
      recoverable: true,
    });
  }

  constructor(message: string, options: StorageErrorOptions = {}) {
    super(`[Tauri FS] ${message}`, {
      ...options,
      recoverable: true, // Tauri failures can fallback to IndexedDB
    });
    this.name = "TauriError";
    Object.setPrototypeOf(this, TauriError.prototype);
  }
}

/**
 * Specific error for data synchronization issues
 */
export class SyncError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(`[Sync] ${message}`, {
      ...options,
      recoverable: false, // Sync errors require manual intervention
    });
    this.name = "SyncError";
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

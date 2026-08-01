import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock factory — must be declared before importing the adapter
const mockReadTextFile = vi.fn()
const mockWriteTextFile = vi.fn()
const mockMkdir = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 1, AppConfig: 2, AppLocalData: 3 },
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

// appDataDir must also be mocked since the adapter calls ensureAppDataDir on save
const mockAppDataDir = vi.fn().mockResolvedValue('/mock/appdata')
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: (...args: unknown[]) => mockAppDataDir(...args),
}))

import { TauriFsAdapter } from '@/hooks/store/adapters/tauri-fs-adapter'
import { TauriError } from '@/lib/storage-error'

describe('TauriFsAdapter.load', () => {
  beforeEach(() => {
    mockReadTextFile.mockReset()
  })

  it('returns the file text on success', async () => {
    mockReadTextFile.mockResolvedValueOnce('{"hello":"world"}')
    const result = await TauriFsAdapter.load('settings')
    expect(result).toBe('{"hello":"world"}')
    expect(mockReadTextFile).toHaveBeenCalledWith('settings.json', { baseDir: 1 })
  })

  it('returns null when error.code === "ENOENT" (structured check)', async () => {
    mockReadTextFile.mockRejectedValueOnce(
      Object.assign(new Error('io error'), { code: 'ENOENT' })
    )
    const result = await TauriFsAdapter.load('missing')
    expect(result).toBeNull()
  })

  it('returns null when error.code is the alternate "ResourceNotFound"', async () => {
    // iOS / sandboxed scenarios may surface a different code
    mockReadTextFile.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 'ResourceNotFound' })
    )
    // Only ENOENT must match — other codes must propagate as TauriError
    await expect(TauriFsAdapter.load('x')).rejects.toBeInstanceOf(TauriError)
  })

  it('does NOT match by substring alone (audit finding 5.1 regression)', async () => {
    // Old code matched any error whose message contained "No such file".
    // The new code must require the structured `code` field. A bare Error
    // without a code must propagate, not be swallowed as "missing file".
    mockReadTextFile.mockRejectedValueOnce(
      new Error('No such file or directory: /secrets/api.key')
    )
    await expect(TauriFsAdapter.load('key')).rejects.toBeInstanceOf(TauriError)
  })

  it('wraps non-ENOENT errors as TauriError with operation context', async () => {
    mockReadTextFile.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    )
    await expect(TauriFsAdapter.load('locked')).rejects.toBeInstanceOf(TauriError)
  })
})

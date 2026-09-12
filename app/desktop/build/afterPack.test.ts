import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type RunCommand = (file: string, args: string[]) => Promise<unknown>
type AfterPackModule = {
  (context: { electronPlatformName: string, appOutDir: string, packager: { appInfo: { productFilename: string } } }, options?: { run?: RunCommand }): Promise<void>
  stripUnusedMacPermissions: (path: string, run?: RunCommand) => Promise<void>
  unusedMacPlistKeys: readonly string[]
}

describe('macOS after-pack privacy hardening', () => {
  it('removes every unused privacy and transport declaration', async () => {
    const hook = require('./afterPack.cjs') as AfterPackModule
    const run = vi.fn<RunCommand>().mockResolvedValue(undefined)

    await hook.stripUnusedMacPermissions('/tmp/My Way.app/Contents/Info.plist', run)

    expect(hook.unusedMacPlistKeys).toEqual([
      'NSAudioCaptureUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSBluetoothPeripheralUsageDescription',
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSAppTransportSecurity'
    ])
    expect(run).toHaveBeenCalledTimes(hook.unusedMacPlistKeys.length)
    for (const key of hook.unusedMacPlistKeys) {
      expect(run).toHaveBeenCalledWith('/usr/libexec/PlistBuddy', [
        '-c',
        `Delete :${key}`,
        '/tmp/My Way.app/Contents/Info.plist'
      ])
    }
  })

  it('ignores keys that are already absent but propagates real failures', async () => {
    const hook = require('./afterPack.cjs') as AfterPackModule
    const absent = vi.fn<RunCommand>().mockRejectedValue(new Error('Does Not Exist'))
    await expect(hook.stripUnusedMacPermissions('/tmp/Info.plist', absent)).resolves.toBeUndefined()

    const failed = vi.fn<RunCommand>().mockRejectedValue(new Error('disk unavailable'))
    await expect(hook.stripUnusedMacPermissions('/tmp/Info.plist', failed)).rejects.toThrow('disk unavailable')
  })

  it('targets only the main macOS application plist', async () => {
    const hook = require('./afterPack.cjs') as AfterPackModule
    const run = vi.fn<RunCommand>().mockResolvedValue(undefined)
    const context = {
      electronPlatformName: 'darwin',
      appOutDir: '/tmp/out',
      packager: { appInfo: { productFilename: 'My Way' } }
    }

    await hook(context, { run })

    expect(run).toHaveBeenCalledWith('/usr/libexec/PlistBuddy', expect.arrayContaining([
      '/tmp/out/My Way.app/Contents/Info.plist'
    ]))
  })

  it('does nothing for non-macOS targets', async () => {
    const hook = require('./afterPack.cjs') as AfterPackModule
    const run = vi.fn<RunCommand>().mockResolvedValue(undefined)
    await hook({
      electronPlatformName: 'linux',
      appOutDir: '/tmp/out',
      packager: { appInfo: { productFilename: 'My Way' } }
    }, { run })

    expect(run).not.toHaveBeenCalled()
  })
})

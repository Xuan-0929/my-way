const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { join } = require('node:path')

const runCommand = promisify(execFile)

const unusedMacPlistKeys = Object.freeze([
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSAppTransportSecurity'
])

const stripUnusedMacPermissions = async (plistPath, run = runCommand) => {
  for (const key of unusedMacPlistKeys) {
    try {
      await run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plistPath])
    } catch (error) {
      const detail = error instanceof Error
        ? `${error.message} ${typeof error.stderr === 'string' ? error.stderr : ''}`
        : String(error)
      if (!detail.includes('Does Not Exist')) throw error
    }
  }
}

const afterPack = async (context, options = {}) => {
  if (context.electronPlatformName !== 'darwin') return
  const plistPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist'
  )
  await stripUnusedMacPermissions(plistPath, options.run)
}

module.exports = afterPack
module.exports.stripUnusedMacPermissions = stripUnusedMacPermissions
module.exports.unusedMacPlistKeys = unusedMacPlistKeys

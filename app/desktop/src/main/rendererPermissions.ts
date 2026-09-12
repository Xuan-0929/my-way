import type { Session } from 'electron'

export type PermissionSession = Pick<
  Session,
  'setPermissionCheckHandler' | 'setPermissionRequestHandler' | 'setDevicePermissionHandler'
>

export type NetworkSession = Pick<Session, 'webRequest'>

const networkRequestPatterns = Object.freeze([
  'http://*/*',
  'https://*/*',
  'ws://*/*',
  'wss://*/*'
])

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const allowedDevelopmentEndpoint = (value?: string): URL | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!loopbackHosts.has(url.hostname)) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export const trustedDevelopmentRendererUrl = (isPackaged: boolean, value?: string): string | undefined => {
  if (isPackaged) return undefined
  return allowedDevelopmentEndpoint(value)?.toString()
}

const matchesDevelopmentEndpoint = (requestUrl: string, developmentEndpoint: URL | null): boolean => {
  if (!developmentEndpoint) return false
  try {
    const request = new URL(requestUrl)
    const allowedProtocols = developmentEndpoint.protocol === 'https:'
      ? new Set(['https:', 'wss:'])
      : new Set(['http:', 'ws:'])
    return allowedProtocols.has(request.protocol)
      && request.hostname === developmentEndpoint.hostname
      && request.port === developmentEndpoint.port
  } catch {
    return false
  }
}

export const denyRendererPermissions = (target: PermissionSession): void => {
  target.setPermissionCheckHandler(() => false)
  target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  target.setDevicePermissionHandler(() => false)
}

export const restrictRendererNetwork = (target: NetworkSession, developmentUrl?: string): void => {
  const developmentEndpoint = allowedDevelopmentEndpoint(developmentUrl)
  target.webRequest.onBeforeRequest({ urls: [...networkRequestPatterns] }, (details, callback) => {
    callback({ cancel: !matchesDevelopmentEndpoint(details.url, developmentEndpoint) })
  })
}

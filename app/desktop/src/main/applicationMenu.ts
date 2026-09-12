import type { MenuItemConstructorOptions } from 'electron'

interface ApplicationMenuOptions {
  isMac: boolean
  appName: string
}

const editMenu = (): MenuItemConstructorOptions => ({
  label: '编辑',
  submenu: [
    { role: 'undo', label: '撤销' },
    { role: 'redo', label: '重做' },
    { type: 'separator' },
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '复制' },
    { role: 'paste', label: '粘贴' },
    { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
    { role: 'delete', label: '删除' },
    { role: 'selectAll', label: '全选' }
  ]
})

const windowMenu = (isMac: boolean): MenuItemConstructorOptions => ({
  label: '窗口',
  submenu: [
    { role: 'togglefullscreen', label: '切换全屏', accelerator: isMac ? 'Control+Command+F' : 'F11' },
    { type: 'separator' },
    { role: 'minimize', label: '最小化' },
    { role: 'zoom', label: '缩放' },
    { role: 'close', label: '关闭窗口' },
    { type: 'separator' },
    { role: 'front', label: '前置全部窗口' }
  ]
})

export const applicationMenuTemplate = ({ isMac, appName }: ApplicationMenuOptions): MenuItemConstructorOptions[] => {
  const lifecycleMenu: MenuItemConstructorOptions = isMac
    ? {
        label: appName,
        submenu: [
          { role: 'about', label: `关于 ${appName}` },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: `隐藏 ${appName}` },
          { role: 'hideOthers', label: '隐藏其他应用' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: `退出 ${appName}` }
        ]
      }
    : { label: '文件', submenu: [{ role: 'close', label: '关闭窗口' }, { role: 'quit', label: '退出' }] }

  return [lifecycleMenu, editMenu(), windowMenu(isMac)]
}

export const zh = {
  'action.undo': '撤销',
  'action.undoTooltip': '撤销此消息及之后内容并恢复文件',
  'action.retry': '重发',
  'action.retryTooltip': '撤销并重发此消息',
  'dialog.title': '确认撤销会话与工作区文件',
  'dialog.description': '撤销将回退该用户消息及之后的所有交互，并将受管理的工作区文件恢复到该消息处理前的状态。是否继续？',
  'dialog.retryTitle': '撤销并重发此消息',
  'dialog.retryDescription': '将回退此消息及后续所有交互并还原工作区文件，你可以选择将原文本填入输入框重新编辑，或立即重新发送。',
  'dialog.confirm': '确认撤销',
  'dialog.cancel': '取消',
  'dialog.retryLoad': '填入输入框',
  'dialog.retrySendNow': '立即重发',
  'toast.success': '已成功撤销，恢复了 {count} 个文件',
  'toast.failed': '撤销失败: {reason}',
}

export const en = {
  'action.undo': 'Undo',
  'action.undoTooltip': 'Undo this message and later turns, restoring workspace files',
  'action.retry': 'Resend',
  'action.retryTooltip': 'Undo and resend this message',
  'dialog.title': 'Confirm Undo Session & Workspace Files',
  'dialog.description': 'Undo will revert this user message and all subsequent turns, restoring workspace files to the state prior to this message. Continue?',
  'dialog.retryTitle': 'Undo & Resend this message',
  'dialog.retryDescription': 'Revert this message and subsequent turns, and choose whether to load the text into the input bar or resend immediately.',
  'dialog.confirm': 'Confirm Undo',
  'dialog.cancel': 'Cancel',
  'dialog.retryLoad': 'Load to Input',
  'dialog.retrySendNow': 'Resend Now',
  'toast.success': 'Successfully undone, restored {count} files',
  'toast.failed': 'Undo failed: {reason}',
}

export type UndoKey = keyof typeof en

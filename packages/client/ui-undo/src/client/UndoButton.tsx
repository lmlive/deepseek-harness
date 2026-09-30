import { useCallback, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserActionOwnerProps } from '@deepseek-ai/dsh-client-ui-chat'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRetryOutlineRegular, IconUndoOutlineRegular } from './IconUndo.tsx'
import type { UndoKey } from './locales.ts'
import css from './UndoButton.module.css'

export interface UndoInjected {
  revert: (seq: number) => Promise<{ success: boolean; newSessionId?: string; revertedFiles?: string[]; message?: string }>
  resend?: (newSessionId: string, text: string) => Promise<void>
  fillDraft?: (newSessionId: string, text: string) => Promise<void>
  openSession?: (newSessionId: string) => void
}

export type UndoButtonProps = UserActionOwnerProps
  & PropsLocale<'undo', UndoKey>
  & { readonly inject: UndoInjected }

export function UndoButton({ seq, text, t, inject }: UndoButtonProps) {
  const [undoOpen, setUndoOpen] = useState(false)
  const [retryOpen, setRetryOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reportError = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[ui-undo] action failed:', cause)
    setError(message)
  }, [])

  const handleUndoOpen = useCallback(() => {
    setError(null)
    setUndoOpen(true)
  }, [])

  const handleUndoClose = useCallback(() => {
    if (!loading) setUndoOpen(false)
  }, [loading])

  const handleRetryOpen = useCallback(() => {
    setError(null)
    setRetryOpen(true)
  }, [])

  const handleRetryClose = useCallback(() => {
    if (!loading) setRetryOpen(false)
  }, [loading])

  const navigateToSession = useCallback((newSessionId: string) => {
    if (!inject.openSession) throw new Error('Session navigation is not available')
    inject.openSession(newSessionId)
  }, [inject])

  const handleUndoConfirm = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      if (!Number.isSafeInteger(seq)) throw new Error('This message has no undo sequence number')
      if (!inject.openSession) throw new Error('Session navigation is not available')
      const res = await inject.revert(seq)
      if (!res.success || !res.newSessionId) throw new Error(res.message ?? 'Undo did not create a new session')
      navigateToSession(res.newSessionId)
      setUndoOpen(false)
    } catch (cause) {
      reportError(cause)
    } finally {
      setLoading(false)
    }
  }, [inject, navigateToSession, reportError, seq])

  const handleRetryLoad = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      if (!Number.isSafeInteger(seq)) throw new Error('This message has no undo sequence number')
      if (!text?.trim()) throw new Error('The original message has no text to restore')
      if (!inject.fillDraft || !inject.openSession) throw new Error('Draft input or session navigation is not available')
      const res = await inject.revert(seq)
      if (!res.success || !res.newSessionId) throw new Error(res.message ?? 'Undo did not create a new session')
      navigateToSession(res.newSessionId)
      await inject.fillDraft(res.newSessionId, text)
      setRetryOpen(false)
    } catch (cause) {
      reportError(cause)
    } finally {
      setLoading(false)
    }
  }, [inject, navigateToSession, reportError, seq, text])

  const handleRetrySendNow = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      if (!Number.isSafeInteger(seq)) throw new Error('This message has no undo sequence number')
      if (!text?.trim()) throw new Error('The original message has no text to resend')
      if (!inject.resend || !inject.openSession) throw new Error('Resend or session navigation is not available')
      const res = await inject.revert(seq)
      if (!res.success || !res.newSessionId) throw new Error(res.message ?? 'Undo did not create a new session')
      navigateToSession(res.newSessionId)
      await inject.resend(res.newSessionId, text)
      setRetryOpen(false)
    } catch (cause) {
      reportError(cause)
    } finally {
      setLoading(false)
    }
  }, [inject, navigateToSession, reportError, seq, text])

  return (
    <div className={css.actionsGroup}>
      <Tooltip label={t('action.retryTooltip')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.retry')}
          onClick={handleRetryOpen}
          data-testid="retry-action-btn"
        >
          <IconRetryOutlineRegular />
        </button>
      </Tooltip>

      <Tooltip label={t('action.undoTooltip')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.undo')}
          onClick={handleUndoOpen}
          data-testid="undo-action-btn"
        >
          <IconUndoOutlineRegular />
        </button>
      </Tooltip>

      {undoOpen && (
        <div className={css.overlay} role="dialog" aria-modal="true" data-testid="undo-dialog">
          <div className={css.dialog}>
            <div className={css.dialogTitle}>{t('dialog.title')}</div>
            <div className={css.dialogDesc}>{t('dialog.description')}</div>
            {error && <div role="alert" className={css.dialogDesc}>{error}</div>}
            <div className={css.dialogFooter}>
              <button
                type="button"
                className={css.btnCancel}
                onClick={handleUndoClose}
                disabled={loading}
              >
                {t('dialog.cancel')}
              </button>
              <button
                type="button"
                className={css.btnConfirm}
                onClick={handleUndoConfirm}
                disabled={loading}
                data-testid="undo-confirm-btn"
              >
                {t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {retryOpen && (
        <div className={css.overlay} role="dialog" aria-modal="true" data-testid="retry-dialog">
          <div className={css.dialog}>
            <div className={css.dialogTitle}>{t('dialog.retryTitle')}</div>
            <div className={css.dialogDesc}>{t('dialog.retryDescription')}</div>
            {error && <div role="alert" className={css.dialogDesc}>{error}</div>}
            <div className={css.dialogFooter}>
              <button
                type="button"
                className={css.btnCancel}
                onClick={handleRetryClose}
                disabled={loading}
              >
                {t('dialog.cancel')}
              </button>
              <button
                type="button"
                className={css.btnSecondary}
                onClick={handleRetryLoad}
                disabled={loading}
                data-testid="retry-load-btn"
              >
                {t('dialog.retryLoad')}
              </button>
              <button
                type="button"
                className={css.btnConfirm}
                onClick={handleRetrySendNow}
                disabled={loading}
                data-testid="retry-send-btn"
              >
                {t('dialog.retrySendNow')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

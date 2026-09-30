import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { UndoButton, type UndoInjected } from './UndoButton.tsx'
import { en, zh } from './locales.ts'

export * from './locales.ts'
export * from './IconUndo.tsx'
export * from './UndoButton.tsx'

const NS = 'undo'

export const inject = ['slots', 'locale', 'remote', 'remote.undo', 'remote.session', 'uiWorkspace', 'sessions', 'conversation']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-undo: dictionaries')

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'undo',
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): UndoInjected => {
      return {
        revert: async (seq: number) => {
          const remote = (ctx as any).remote?.undo
          if (typeof remote?.revert !== 'function') throw new Error('remote.undo.revert is not available')
          const result = await remote.revert(sessionId, seq)
          if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
          return result.value
        },
        openSession: (newSessionId: string) => {
          const workspace = (ctx as any).uiWorkspace
          if (typeof workspace?.openSession !== 'function') throw new Error('Session navigation is not available')
          workspace.openSession(newSessionId)
        },
        fillDraft: async (newSessionId: string, text: string) => {
          const sessions = (ctx as any).sessions
          const conversation = (ctx as any).conversation
          if (typeof sessions?.using !== 'function' || !conversation?.input) {
            throw new Error('Session composer is not available')
          }
          await sessions.using(newSessionId, { source: 'controllerOperation' }, async (reference: any) => {
            await reference.ready
            const scoped = sessions.scope(newSessionId)
            if (!scoped) throw new Error('New session could not be opened')
            conversation.input.for(scoped).setDraft(text)
          })
        },
        resend: async (newSessionId: string, text: string) => {
          const sessions = (ctx as any).sessions
          if (typeof sessions?.using !== 'function') throw new Error('Session service is not available')
          await sessions.using(newSessionId, { source: 'controllerOperation' }, async (reference: any) => {
            await reference.ready
            const scoped = sessions.scope(newSessionId)
            if (!scoped) throw new Error('New session could not be opened')
            const conversation = scoped.get('conversation')
            if (typeof conversation?.send !== 'function') throw new Error('Conversation send is not available')
            await conversation.send(text)
          })
        },
      }
    },
  }, UndoButton))
}

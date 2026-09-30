import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Standard Undo / counter-clockwise arrow icon.
 */
export function IconUndoOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 3.5L2.5 7L6 10.5" />
      <path d="M3 7h6.5a4 4 0 0 1 4 4v1" />
    </svg>
  )
}

/**
 * Standard Resend / Retry / Refresh clockwise circular arrow icon.
 */
export function IconRetryOutlineRegular({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.5 6.5A5.5 5.5 0 1 0 14 8.5" />
      <path d="M13.5 3v3.5H10" />
    </svg>
  )
}

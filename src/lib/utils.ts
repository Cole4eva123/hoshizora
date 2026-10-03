import { cn } from "cn"

export { cn }

// One pill of a Pills row, picked or not. Also dresses a control that sits in the row, like the menu of older seasons.
export const pill = (picked: boolean) =>
  cn(
    'cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-card',
    picked && 'border-primary bg-primary/10 text-primary',
  )

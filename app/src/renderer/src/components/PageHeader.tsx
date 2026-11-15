export function PageHeader({
  title,
  description,
  actions
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-balance">{title}</h2>
        {description && <p className="text-xs text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

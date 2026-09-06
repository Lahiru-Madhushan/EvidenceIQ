export default function AlertBanner({ type = 'error', children }) {
  if (!children) return null

  const styles =
    type === 'success'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-red-50 text-red-700 border-red-200'

  return (
    <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

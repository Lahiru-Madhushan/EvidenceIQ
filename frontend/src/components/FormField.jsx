// `className` defaults to the standard bottom margin. A caller laying fields out in a
// grid passes "mb-0" and lets the grid's own gap do the spacing instead.
export default function FormField({ label, id, error, children, className = 'mb-5' }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-brand-black mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}

export function TextInput({ id, error, className = '', icon: Icon, ...props }) {
  return (
    <div className="relative">
      {Icon && (
        <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400 pointer-events-none">
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </span>
      )}
      <input
        id={id}
        className={`w-full rounded-lg border px-3.5 py-2.5 text-brand-black placeholder:text-neutral-400
          focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue
          transition-colors ${Icon ? 'pl-10' : ''} ${error ? 'border-red-400' : 'border-neutral-200'} ${className}`}
        {...props}
      />
    </div>
  )
}

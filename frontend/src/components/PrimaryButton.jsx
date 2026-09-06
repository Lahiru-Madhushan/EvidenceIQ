import { ArrowRight } from 'lucide-react'

export default function PrimaryButton({ children, loading, disabled, type = 'submit', showArrow = true, ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5
        text-white font-medium transition-colors hover:bg-brand-blue-dark
        disabled:opacity-60 disabled:cursor-not-allowed"
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
      {showArrow && !loading && <ArrowRight className="w-4 h-4" strokeWidth={2} />}
    </button>
  )
}

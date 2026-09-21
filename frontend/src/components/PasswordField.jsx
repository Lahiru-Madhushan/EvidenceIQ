import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import FormField from './FormField'

export default function PasswordField({ label, id, value, onChange, error, placeholder, autoComplete, required, className }) {
  const [visible, setVisible] = useState(false)

  return (
    <FormField label={label} id={id} error={error} className={className}>
      <div className="relative">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400 pointer-events-none">
          <Lock className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </span>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`w-full rounded-lg border pl-10 pr-11 py-2.5 text-brand-black placeholder:text-neutral-400
            focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue
            transition-colors ${error ? 'border-red-400' : 'border-neutral-200'}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-400 hover:text-brand-blue"
          tabIndex={-1}
        >
          {visible ? <EyeOff className="w-[18px] h-[18px]" strokeWidth={1.8} /> : <Eye className="w-[18px] h-[18px]" strokeWidth={1.8} />}
        </button>
      </div>
    </FormField>
  )
}

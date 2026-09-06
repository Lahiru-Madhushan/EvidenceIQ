import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function App() {
  const [apiStatus, setApiStatus] = useState('checking...')

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((res) => res.json())
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold text-slate-800">EvidenceIQ</h1>
      <p className="text-slate-500">Systematic Review Screening Assistant</p>
      <span className="text-sm px-3 py-1 rounded-full bg-slate-200 text-slate-700">
        API status: {apiStatus}
      </span>
    </div>
  )
}

export default App

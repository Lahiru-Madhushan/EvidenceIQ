import { useEffect, useRef, useState } from 'react'

export default function FitToHeight({ children, className = '' }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const update = () => {
      const availableHeight = outer.clientHeight
      const neededHeight = inner.scrollHeight
      setScale(neededHeight > availableHeight ? availableHeight / neededHeight : 1)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outerRef} className={`w-full h-full flex items-center justify-center overflow-hidden ${className}`}>
      <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: 'center' }} className="w-full max-w-md">
        {children}
      </div>
    </div>
  )
}

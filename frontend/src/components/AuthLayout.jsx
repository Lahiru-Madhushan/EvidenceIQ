import AuthLeftPanel from './AuthLeftPanel'
import ScaledCoverCanvas from './ScaledCoverCanvas'
import FitToHeight from './FitToHeight'

export default function AuthLayout({ title, subtitle, children, footer, legalFooter, leftPanelImage }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-white flex">
      <div className="w-full h-full flex">
        <div className="hidden lg:block lg:w-[45%] h-full">
          {leftPanelImage ? (
            <ScaledCoverCanvas width={648} height={900}>
              <img src={leftPanelImage} alt="" className="absolute inset-0 w-full h-full" />
              <div className="absolute inset-0">
                <AuthLeftPanel showBackground={false} />
              </div>
            </ScaledCoverCanvas>
          ) : (
            <AuthLeftPanel />
          )}
        </div>

        <div className="relative flex-1 h-full overflow-hidden flex px-6 sm:px-10 lg:px-14 py-10 bg-gradient-to-br from-white via-white to-blue-50">
          <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-blue-100/50 blur-3xl pointer-events-none" />

          <FitToHeight>
            <div className="relative w-full max-w-md">
              <div className="flex justify-center mb-8">
                <img src="/logo.png" alt="EvidenceIQ" className="h-14 w-auto" />
              </div>

              <div className="text-center mb-8">
                <h1 className="text-2xl font-semibold text-brand-black">{title}</h1>
                {subtitle && <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>}
              </div>

              {children}

              {footer && <div className="mt-6 text-center text-sm text-neutral-500">{footer}</div>}
              {legalFooter && <div className="mt-4 text-center text-xs text-neutral-400">{legalFooter}</div>}
            </div>
          </FitToHeight>
        </div>
      </div>
    </div>
  )
}

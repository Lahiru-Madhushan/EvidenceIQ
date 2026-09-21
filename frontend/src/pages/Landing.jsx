import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/landing/Navbar'
import Hero from '../components/landing/Hero'
import ChallengeSection from '../components/landing/ChallengeSection'
import WorkflowSection from '../components/landing/WorkflowSection'
import DemoSection from '../components/landing/DemoSection'
import FeaturesSection from '../components/landing/FeaturesSection'
import PricingSection from '../components/landing/PricingSection'
import CTASection from '../components/landing/CTASection'
import Footer from '../components/landing/Footer'

export default function Landing() {
  const { user, loading } = useAuth()

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="bg-white">
      <Navbar />
      <Hero />
      <ChallengeSection />
      <WorkflowSection />
      <DemoSection />
      <FeaturesSection />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  )
}

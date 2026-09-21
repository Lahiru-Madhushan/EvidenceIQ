import { Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute'
import QuickChat from './pages/QuickChat'
import Dashboard from './pages/Dashboard'
import DashboardHome from './pages/DashboardHome'
import ForgotPassword from './pages/ForgotPassword'
import NewReview from './pages/NewReview'
import Reviews from './pages/Reviews'
import Landing from './pages/Landing'
import Login from './pages/Login'
import PaperList from './pages/PaperList'
import Register from './pages/Register'
import Settings from './pages/Settings'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/verify-email"
        element={<VerifyEmail />}
      />
      <Route
        path="/forgot-password"
        element={<ForgotPassword />}
      />
      <Route
        path="/reset-password"
        element={<ResetPassword />}
      />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/quick-chat" element={<QuickChat />} />
        <Route path="/settings" element={<Settings />} />

        {/* Declared before /reviews/:reviewId so "new" is not read as an id. */}
        <Route path="/reviews/new" element={<NewReview />} />
        <Route path="/reviews/:reviewId" element={<Dashboard />} />

        <Route
          path="/reviews/:reviewId/papers"
          element={<PaperList />}
        />

        <Route
          path="/papers"
          element={<PaperList />}
        />
      </Route>
    </Routes>
  )
}

export default App
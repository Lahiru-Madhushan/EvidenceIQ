import { Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Landing from './pages/Landing'
import Login from './pages/Login'
import PaperList from './pages/PaperList'
import Register from './pages/Register'
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
        <Route path="/dashboard" element={<Home />} />

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
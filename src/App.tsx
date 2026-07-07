import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth-store'
import Home from './pages/Home'
import Login from './pages/Login'
import darkDenim from './images/darkdenim3.png'

function App() {
  const { aclUser, loading, initAuth } = useAuthStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        Loading...
      </div>
    )
  }

  return (
    <div
      className="w-full bg-repeat min-h-screen flex flex-col p-0"
      style={{ backgroundImage: `url(${darkDenim})` }}
    >
      <Router>
        <Routes>
          <Route
            path="/"
            element={aclUser ? <Home /> : <Navigate to="/login" replace />}
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </Router>
    </div>
  )
}

export default App

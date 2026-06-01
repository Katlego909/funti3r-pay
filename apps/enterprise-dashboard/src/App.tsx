import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { HiOutlineChartBar, HiOutlineArrowPathRoundedSquare, HiOutlineUsers, HiOutlineCog6Tooth } from 'react-icons/hi2';
import Dashboard from './pages/Dashboard';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <div className="header-container">
            <div className="logo">
              <h1>Funti3r-pay</h1>
              <p className="tagline">Cross-Border Workforce Payments</p>
            </div>
            <nav className="nav">
              <Link to="/" className="nav-link">
                <HiOutlineChartBar size={18} />
                <span>Dashboard</span>
              </Link>
              <Link to="/" className="nav-link">
                <HiOutlineArrowPathRoundedSquare size={18} />
                <span>Payments</span>
              </Link>
              <Link to="/" className="nav-link">
                <HiOutlineUsers size={18} />
                <span>Users</span>
              </Link>
              <Link to="/" className="nav-link">
                <HiOutlineCog6Tooth size={18} />
                <span>Settings</span>
              </Link>
            </nav>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import {
  HiOutlineChartBar,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineUsers,
  HiOutlineCog6Tooth,
  HiOutlineBars3,
} from 'react-icons/hi2';
import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import './App.css';

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <div className="header-container">
            <div className="logo">
              <h1>Funti3rPay</h1>
              <p className="tagline">Cross-Border Workforce Payments</p>
            </div>
            <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
              <HiOutlineBars3 size={24} />
            </button>
            <nav className={`nav ${menuOpen ? 'open' : ''}`}>
              <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>
                <HiOutlineChartBar size={18} />
                <span>Dashboard</span>
              </Link>
              <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>
                <HiOutlineArrowPathRoundedSquare size={18} />
                <span>Payments</span>
              </Link>
              <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>
                <HiOutlineUsers size={18} />
                <span>Users</span>
              </Link>
              <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>
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

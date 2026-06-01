import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
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
              <Link to="/" className="nav-link">Dashboard</Link>
              <Link to="/" className="nav-link">Payments</Link>
              <Link to="/" className="nav-link">Users</Link>
              <Link to="/" className="nav-link">Settings</Link>
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

import { BrowserRouter, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <h1>Funti3r-pay Enterprise Dashboard</h1>
        </header>
        <Routes>
          <Route
            path="/"
            element={<div>Welcome to Funti3r-pay Dashboard - Coming Soon</div>}
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

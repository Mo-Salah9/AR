import { HashRouter, Routes, Route } from 'react-router-dom';
import Scanner from './pages/Scanner';
import Admin from './pages/Admin';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Scanner />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </HashRouter>
  );
}

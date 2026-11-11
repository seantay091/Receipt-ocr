import { NavLink, Route, Routes } from "react-router-dom";
import { useConfig } from "./ConfigContext";
import Dashboard from "./pages/Dashboard";
import Placeholder from "./pages/Placeholder";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/upload", label: "Upload" },
  { to: "/items", label: "Items" },
  { to: "/receipts", label: "Receipts" },
  { to: "/contacts", label: "Contacts" },
  { to: "/tags", label: "Tags" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const { error } = useConfig();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Receipt Tracker</div>
        <ul>
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="content">
        {error && (
          <div className="banner error" role="alert">
            Cannot reach the server: {error}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Placeholder title="Upload" step={2} />} />
          <Route path="/review/:fileId" element={<Placeholder title="Review" step={3} />} />
          <Route path="/items" element={<Placeholder title="Items" step={4} />} />
          <Route path="/receipts" element={<Placeholder title="Receipts" step={3} />} />
          <Route path="/receipts/:id" element={<Placeholder title="Receipt" step={3} />} />
          <Route path="/contacts" element={<Placeholder title="Contacts" step={3} />} />
          <Route path="/tags" element={<Placeholder title="Tags" step={3} />} />
          <Route path="/settings" element={<Placeholder title="Settings" step={6} />} />
          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
      </main>
    </div>
  );
}

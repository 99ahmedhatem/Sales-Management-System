import { useState } from 'react';
import { Role } from '../data/mockData';

interface Props {
  onLogin: (role: Role, userId: string) => void;
}

const CREDENTIALS: { username: string; password: string; role: Role; userId: string; label: string }[] = [
  { username: 'admin', password: 'admin123', role: 'admin', userId: 'u1', label: 'Admin — Full system access' },
  { username: 'rania.mgr', password: 'mgr123', role: 'manager', userId: 'um1', label: 'Manager — Rania Al-Farsi' },
  { username: 'sara.ts', password: 'ts123', role: 'telesales', userId: 'u2', label: 'Telesales — Sara Hassan' },
  { username: 'diana.sales', password: 'sales123', role: 'sales', userId: 'u6', label: 'Sales — Diana Reeves' },
];

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setTimeout(() => {
      const cred = CREDENTIALS.find(c => c.username === username && c.password === password);
      if (cred) {
        onLogin(cred.role, cred.userId);
      } else {
        setError('Invalid username or password.');
      }
      setLoading(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-[#dfff03] rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <span className="text-white font-bold text-xl tracking-tight lowercase">intillaq</span>
          </div>
          <h1 className="text-white font-semibold text-xl">Sign in to your account</h1>
          <p className="text-[#6b6b6b] text-sm mt-1">Sales & Telesales Management System</p>
        </div>

        {/* Form */}
        <div className="bg-[#161616] border border-[#262626] rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5 uppercase tracking-wide">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5 uppercase tracking-wide">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/50 transition-colors"
              />
            </div>
            {error && <p className="text-[#ff6464] text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-[#dfff03] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4f002] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

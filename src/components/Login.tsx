import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfoMsg('');
    let loginEmail = email.trim();
    if (!loginEmail.includes('@')) {
      const { data: user, error: lookupError } = await supabase
        .from('users')
        .select('email')
        .eq('username', loginEmail)
        .maybeSingle();
      if (lookupError || !user?.email) {
        setError('Employee code or email was not found.');
        setLoading(false);
        return;
      }
      loginEmail = user.email;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) setError(error.message);
    setLoading(false);
    // On success, App.tsx's onAuthStateChange listener takes over automatically.
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfoMsg('');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
    } else {
      setInfoMsg('Account created! Check your email to confirm it, then sign in below.');
      setMode('signin');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-[#dfff03] rounded-md flex items-center justify-center overflow-hidden">
              <span className="text-black font-black text-2xl leading-none tracking-[-0.15em]">N</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight lowercase">intillaq system</span>
          </div>
          <h1 className="text-white font-semibold text-xl">
            {mode === 'signin' ? 'Sign in to your account' : 'Create the admin account'}
          </h1>
          <p className="text-[#6b6b6b] text-sm mt-1">Sales & Telesales Management System</p>
        </div>

        {/* Form */}
        <div className="bg-[#161616] border border-[#262626] rounded-xl p-6">
          <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
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
            {infoMsg && <p className="text-[#dfff03] text-xs">{infoMsg}</p>}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-[#dfff03] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4f002] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
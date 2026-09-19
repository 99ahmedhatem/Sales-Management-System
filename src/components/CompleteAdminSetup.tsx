import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { generateCode } from '../data/mockData';

interface Props {
  authId: string;
  email: string;
  onDone: () => void;
}

// Shown once: right after the very first confirmed sign-in, when there is no
// matching row in public.users yet. Creates that row as the admin account.
export default function CompleteAdminSetup({ authId, email, onDone }: Props) {
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.from('users').insert({
      id: authId,
      username: generateCode('EMP'),
      full_name: fullName,
      role: 'admin',
      status: 'active',
      email,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    onDone();
  };

  return (
    <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-white font-semibold text-xl">Finish setting up your admin account</h1>
          <p className="text-[#6b6b6b] text-sm mt-1">{email}</p>
        </div>
        <div className="bg-[#161616] border border-[#262626] rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5 uppercase tracking-wide">Full Name</label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Ahmed Hatem"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/50 transition-colors"
              />
            </div>
            {error && <p className="text-[#ff6464] text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading || !fullName}
              className="w-full bg-[#dfff03] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4f002] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Finish Setup'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
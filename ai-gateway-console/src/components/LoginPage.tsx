import { useState, FormEvent } from 'react';

interface LoginPageProps {
  onLogin: (token: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      onLogin(data.data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-surface border border-outline-variant rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-white text-[28px]">shield_lock</span>
            </div>
            <h1 className="text-headline-md text-on-surface" style={{ fontSize: '20px', lineHeight: '28px', fontWeight: 600 }}>
              AI Gateway Console
            </h1>
            <p className="text-body-md text-on-surface-variant mt-1">请使用管理员账号登录</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-label-md text-on-surface-variant block">用户名</label>
              <input
                type="text"
                value="admin"
                disabled
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-4 py-2.5 text-body-md opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label className="text-label-md text-on-surface-variant block">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                placeholder="请输入管理员密码"
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-body-md focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              />
            </div>

            {error && (
              <div className="bg-error-container text-on-error-container text-body-md px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-primary text-on-primary font-label-md py-2.5 rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ChatScreen } from '@/components/ChatScreen';
import { LoginScreen } from '@/components/LoginScreen';
import { Mascot } from '@/components/Mascot';
import { SettingsScreen } from '@/components/SettingsScreen';
import { api, onUnauthorized } from '@/lib/api';

type View = 'loading' | 'login' | 'chat' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('loading');

  useEffect(() => {
    onUnauthorized(() => setView('login'));
    api
      .me()
      .then((r) => setView(r.authenticated ? 'chat' : 'login'))
      .catch(() => setView('login'));
  }, []);

  if (view === 'loading') {
    return (
      <div className="grid h-dvh place-items-center">
        <Mascot className="size-20" thinking />
      </div>
    );
  }
  if (view === 'login') return <LoginScreen onSuccess={() => setView('chat')} />;
  if (view === 'settings') {
    return <SettingsScreen onBack={() => setView('chat')} onLoggedOut={() => setView('login')} />;
  }
  return <ChatScreen onOpenSettings={() => setView('settings')} />;
}

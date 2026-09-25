import { useEffect, useState } from 'react';
import { ChatScreen } from '@/components/ChatScreen';
import { LoginScreen } from '@/components/LoginScreen';
import { Mascot } from '@/components/Mascot';
import { SettingsScreen } from '@/components/SettingsScreen';
import { clearChatSnapshot } from '@/chat/useChat';
import { api, onUnauthorized } from '@/lib/api';
import { BotNameProvider } from '@/lib/botName';
import { navigateWithTransition } from '@/lib/viewTransition';

type View = 'loading' | 'login' | 'chat' | 'settings';

function Screen({ view, setView }: { view: View; setView: (v: View) => void }) {
  if (view === 'loading') {
    return (
      <div className="grid h-dvh place-items-center">
        <Mascot className="size-24 shadow-soft" thinking />
      </div>
    );
  }
  if (view === 'login') return <LoginScreen onSuccess={() => setView('chat')} />;
  if (view === 'settings') {
    return (
      <SettingsScreen
        onBack={() => navigateWithTransition('back', () => setView('chat'))}
        onLoggedOut={() => {
          clearChatSnapshot();
          setView('login');
        }}
      />
    );
  }
  return <ChatScreen onOpenSettings={() => navigateWithTransition('forward', () => setView('settings'))} />;
}

export default function App() {
  const [view, setView] = useState<View>('loading');

  useEffect(() => {
    onUnauthorized(() => {
      clearChatSnapshot();
      setView('login');
    });
    api
      .me()
      .then((r) => setView(r.authenticated ? 'chat' : 'login'))
      .catch(() => setView('login'));
  }, []);

  return (
    <BotNameProvider authenticated={view === 'chat' || view === 'settings'}>
      <Screen view={view} setView={setView} />
    </BotNameProvider>
  );
}

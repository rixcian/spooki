import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export const DEFAULT_BOT_NAME = 'Spooki';
const STORAGE_KEY = 'spooki.botName';

function readCached(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_BOT_NAME;
  } catch {
    return DEFAULT_BOT_NAME;
  }
}

const BotNameContext = createContext<{ name: string; setName: (name: string) => void }>({
  name: DEFAULT_BOT_NAME,
  setName: () => {},
});

/** The server holds the name; a local copy lets the login screen greet by name too. */
export function BotNameProvider({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
  const [name, setNameState] = useState(readCached);

  const setName = useCallback((next: string) => {
    setNameState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode: the in-memory name still works
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    api
      .getSettings()
      .then((s) => setName(s.botName))
      .catch(() => {});
  }, [authenticated, setName]);

  return <BotNameContext.Provider value={{ name, setName }}>{children}</BotNameContext.Provider>;
}

export const useBotName = () => useContext(BotNameContext);

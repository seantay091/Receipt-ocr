import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getConfig, type AppConfig } from "./api";

type State = { config: AppConfig | null; error: string | null };

const ConfigContext = createContext<State>({ config: null, error: null });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ config: null, error: null });
  useEffect(() => {
    getConfig()
      .then((config) => setState({ config, error: null }))
      .catch((e: Error) => setState({ config: null, error: e.message }));
  }, []);
  return <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>;
}

export const useConfig = () => useContext(ConfigContext);

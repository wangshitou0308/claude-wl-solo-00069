import React, { createContext, useContext, useSyncExternalStore } from 'react';
import type { State } from '../domain/types';
import type { ProjectStore } from '../data/store';

interface StoreCtx {
  store: ProjectStore;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ store, children }: { store: ProjectStore; children: React.ReactNode }) {
  return <Ctx.Provider value={{ store }}>{children}</Ctx.Provider>;
}

export function useStore(): ProjectStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider 缺失');
  return v.store;
}

export function useStateSnapshot(): State {
  const store = useStore();
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => null,
  );
  if (!state) throw new Error('状态未加载');
  return state;
}

"use client";

import type { ReactNode } from "react";
import { ConfirmProvider } from "./ConfirmDialog";
import { ToastProvider } from "./Toast";

/**
 * Junta os provedores de UI que o painel inteiro consome (`useConfirm`,
 * `useToast`). Existe como componente próprio porque `app/(admin)/layout.tsx` é
 * Server Component: os provedores precisam de um limite `"use client"`, e os
 * `children` vindos do servidor passam por aqui sem virar client.
 */
export function AppDialogs({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      <ToastProvider>{children}</ToastProvider>
    </ConfirmProvider>
  );
}

import React, { useState } from 'react';

interface Toast { id: string; type: 'success' | 'error' | 'info'; message: string; }

const toasts: Toast[] = [];
let setToastsGlobal: React.Dispatch<React.SetStateAction<Toast[]>> | null = null;

export function addToast(type: Toast['type'], message: string) {
  const id = Date.now().toString();
  const toast = { id, type, message };
  setToastsGlobal?.((prev) => [...prev, toast]);
  setTimeout(() => setToastsGlobal?.((prev) => prev.filter((t) => t.id !== id)), 4000);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  setToastsGlobal = setToasts;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type} animate-slide`}>
          <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

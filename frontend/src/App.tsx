import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { QueuesPage } from './pages/QueuesPage';
import { JobsPage } from './pages/JobsPage';
import { WorkersPage } from './pages/WorkersPage';
import { MetricsPage } from './pages/MetricsPage';
import { DLQPage } from './pages/DLQPage';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import api from './api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1 },
  },
});

function AppLayout() {
  const { user, orgs, activeOrg } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any>(null);
  const [dlqCount, setDlqCount] = useState(0);
  const { connected, lastEvent } = useWebSocket(activeProject?.id || null);

  useEffect(() => {
    if (!user) return;
    api.get('/projects').then(r => {
      const projs = r.data.projects;
      setProjects(projs);
      if (projs.length > 0 && !activeProject) {
        setActiveProject(projs[0]);
      }
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!activeProject) return;
    api.get(`/dlq?projectId=${activeProject.id}&resolved=false`).then(r => {
      setDlqCount(r.data.entries?.length || 0);
    }).catch(() => {});
  }, [activeProject, lastEvent]);

  const handleProjectChange = (id: string) => {
    const p = projects.find((p: any) => p.id === id);
    if (p) setActiveProject(p);
  };

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar
        wsConnected={connected}
        dlqCount={dlqCount}
        activeProject={activeProject}
        projects={projects}
        onProjectChange={handleProjectChange}
      />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage projectId={activeProject?.id || ''} />} />
          <Route path="/queues" element={<QueuesPage projectId={activeProject?.id || ''} />} />
          <Route path="/jobs" element={<JobsPage projectId={activeProject?.id || ''} />} />
          <Route path="/workers" element={<WorkersPage projectId={activeProject?.id || ''} />} />
          <Route path="/metrics" element={<MetricsPage projectId={activeProject?.id || ''} />} />
          <Route path="/dlq" element={<DLQPage projectId={activeProject?.id || ''} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/*" element={<PrivateRoute><AppLayout /></PrivateRoute>} />
          </Routes>
          <ToastContainer />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return !user ? <>{children}</> : <Navigate to="/" replace />;
}

export default App;

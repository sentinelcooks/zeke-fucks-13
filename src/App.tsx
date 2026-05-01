import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ParlaySlipProvider } from "@/contexts/ParlaySlipContext";
import DashboardLayout from "./pages/DashboardLayout";
import NbaPropsPage from "./pages/NbaPropsPage";

import UfcPage from "./pages/UfcPage";
import ParlayPage from "./pages/ParlayPage";
import ProfitTrackerPage from "./pages/ProfitTrackerPage";
import MoneyLinePage from "./pages/MoneyLinePage";
import FreePicksPage from "./pages/FreePicksPage";
import FreePropsPage from "./pages/FreePropsPage";
import HomePage from "./pages/HomePage";
import LegalPage from "./pages/LegalPage";

import GamesPage from "./pages/GamesPage";
import SettingsPage from "./pages/SettingsPage";
import ArbitragePage from "./pages/ArbitragePage";

import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";
import { DeepLinkHandler } from "./components/DeepLinkHandler";

const AuthPage = lazy(() => import("./pages/AuthPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const PaywallPage = lazy(() => import("./pages/PaywallPage"));
const WelcomeConfirmationPage = lazy(() => import("./pages/WelcomeConfirmationPage"));

const queryClient = new QueryClient();

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { profile, isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  // Auth resolved but profile fetch is still in-flight (setTimeout(0) defer in AuthContext).
  // Without this guard an authenticated user briefly sees onboarding before the redirect fires.
  if (isAuthenticated && profile === null) return <LoadingSpinner />;

  // Escape hatch: ?force=1 bypasses the guard so onboarding can always be re-entered for testing/QA.
  const forceParam = new URLSearchParams(window.location.search).get("force");
  if (forceParam === "1") {
    localStorage.removeItem("sentinel_onboarding_complete");
    return <>{children}</>;
  }

  // Only redirect away from onboarding for authenticated users who already completed it.
  // Unauthenticated visitors should always be able to step through onboarding.
  if (!isAuthenticated) return <>{children}</>;

  const localComplete = localStorage.getItem("sentinel_onboarding_complete") === "true";
  const serverComplete = profile?.onboarding_complete === true;
  if (localComplete || serverComplete) {
    if (serverComplete && !localComplete) {
      localStorage.setItem("sentinel_onboarding_complete", "true");
    }
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <>
      <DeepLinkHandler />
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={
        <Suspense fallback={<LoadingSpinner />}>
          <AuthPage />
        </Suspense>
      } />
      <Route path="/auth/callback" element={
        <Suspense fallback={<LoadingSpinner />}>
          <AuthCallbackPage />
        </Suspense>
      } />
      <Route path="/admin" element={
        <Suspense fallback={<LoadingSpinner />}>
          <AdminPage />
        </Suspense>
      } />
      <Route path="/onboarding" element={
        <Suspense fallback={<LoadingSpinner />}>
          <OnboardingGuard>
            <OnboardingPage />
          </OnboardingGuard>
        </Suspense>
      } />
      <Route path="/paywall" element={
        <Suspense fallback={<LoadingSpinner />}>
          <PaywallPage />
        </Suspense>
      } />
      <Route path="/legal" element={
        <Suspense fallback={<LoadingSpinner />}>
          <LegalPage />
        </Suspense>
      } />
      <Route path="/welcome" element={
        <Suspense fallback={<LoadingSpinner />}>
          <WelcomeConfirmationPage />
        </Suspense>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardLayout />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="picks" element={<FreePicksPage />} />
        <Route path="free-props" element={<FreePropsPage />} />
        <Route path="analyze" element={<NbaPropsPage />} />
        <Route path="moneyline" element={<MoneyLinePage />} />
        <Route path="ufc" element={<UfcPage />} />
        <Route path="parlay" element={<ParlayPage />} />
        <Route path="tracker" element={<ProfitTrackerPage />} />
        
        <Route path="games" element={<GamesPage />} />
        <Route path="arbitrage" element={<ArbitragePage />} />
        <Route path="mlb-predictions" element={<Navigate to="/dashboard/moneyline" replace />} />
        <Route path="trends" element={<Navigate to="/dashboard/free-picks" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="legal" element={<LegalPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <ParlaySlipProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ParlaySlipProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;

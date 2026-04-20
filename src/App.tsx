import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ParlaySlipProvider } from "@/contexts/ParlaySlipContext";

// Lazy-load every route — initial bundle only ships LandingPage + shared chunks.
const LandingPage = lazy(() => import("./pages/LandingPage"));
const DashboardLayout = lazy(() => import("./pages/DashboardLayout"));
const HomePage = lazy(() => import("./pages/HomePage"));
const NbaPropsPage = lazy(() => import("./pages/NbaPropsPage"));
const UfcPage = lazy(() => import("./pages/UfcPage"));
const ParlayPage = lazy(() => import("./pages/ParlayPage"));
const ProfitTrackerPage = lazy(() => import("./pages/ProfitTrackerPage"));
const MoneyLinePage = lazy(() => import("./pages/MoneyLinePage"));
const FreePicksPage = lazy(() => import("./pages/FreePicksPage"));
const FreePropsPage = lazy(() => import("./pages/FreePropsPage"));
const GamesPage = lazy(() => import("./pages/GamesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ArbitragePage = lazy(() => import("./pages/ArbitragePage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const AuthPage = lazy(() => import("./pages/AuthPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const PaywallPage = lazy(() => import("./pages/PaywallPage"));
const WelcomeConfirmationPage = lazy(() => import("./pages/WelcomeConfirmationPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});

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
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="/onboarding"
          element={
            <OnboardingGuard>
              <OnboardingPage />
            </OnboardingGuard>
          }
        />
        <Route path="/paywall" element={<PaywallPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/welcome" element={<WelcomeConfirmationPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
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
    </Suspense>
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

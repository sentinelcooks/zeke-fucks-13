import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SplashScreen } from "@/components/SplashScreen";

const LandingPage = () => {
  const [showSplash, setShowSplash] = useState(true);
  const navigate = useNavigate();

  const handleSplashFinished = useCallback(() => {
    setShowSplash(false);
    navigate("/onboarding", { replace: true });
  }, [navigate]);

  if (showSplash) {
    return <SplashScreen onFinished={handleSplashFinished} />;
  }

  return null;
};

export default LandingPage;

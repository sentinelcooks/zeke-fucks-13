import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-center pt-safe pb-safe">
      <BrandMark size={64} />
      <h1 className="text-[28px] font-bold text-foreground">This page doesn't exist</h1>
      <p className="max-w-[300px] text-[17px] text-muted-foreground">The link may be old, or the page may have moved.</p>
      <Link
        to="/dashboard/home"
        className="mt-2 flex h-[52px] items-center justify-center rounded-full bg-primary px-8 text-[17px] font-semibold text-primary-foreground active:scale-[0.98]"
      >
        Go to Today
      </Link>
    </div>
  );
};

export default NotFound;

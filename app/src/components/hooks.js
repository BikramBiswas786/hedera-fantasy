import { useEffect, useState } from "react";

/** Re-render every second, for countdowns. */
export function useTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

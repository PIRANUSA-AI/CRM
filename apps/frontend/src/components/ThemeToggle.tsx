import { Moon, Sun } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";
import { animateThemeChange, cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  const handleToggle = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isAnimating) return;

    const nextTheme = isDark ? "light" : "dark";
    const rect = buttonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : event.clientX;
    const y = rect ? rect.top + rect.height / 2 : event.clientY;

    setIsAnimating(true);

    try {
      await animateThemeChange(
        () => {
          flushSync(() => {
            setTheme(nextTheme);
          });
        },
        {
          x,
          y,
          reverse: nextTheme === "light",
        },
      );
    } finally {
      setIsAnimating(false);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleToggle}
      className={cn(
        "relative inline-flex size-10 items-center justify-center rounded-full border border-border/80 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-busy={isAnimating}
      aria-label={`Beralih ke mode ${isDark ? "terang" : "gelap"}`}
      title={`Beralih ke mode ${isDark ? "terang" : "gelap"}`}
    >
      <Sun
        className={cn(
          "size-5 transition-all duration-200",
          isDark
            ? "rotate-90 scale-0 opacity-0"
            : "rotate-0 scale-100 opacity-100",
        )}
      />
      <Moon
        className={cn(
          "absolute size-5 transition-all duration-200",
          isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-0 opacity-0",
        )}
      />
    </button>
  );
}

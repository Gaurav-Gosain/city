import { useState } from "react";
import { City } from "./City";
import { Realistic } from "./Realistic";

type Mode = "city" | "realistic";

const STORAGE_KEY = "city-mode";

function readMode(): Mode {
  if (typeof localStorage === "undefined") return "city";
  return localStorage.getItem(STORAGE_KEY) === "realistic" ? "realistic" : "city";
}

export function App() {
  const [mode, setMode] = useState<Mode>(readMode);
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    setMode(next);
  };
  return (
    <>
      {mode === "city" ? <City key="city" /> : <Realistic key="realistic" />}
      <ModeSwitcher current={mode} onChange={switchMode} />
    </>
  );
}

function ModeSwitcher({ current, onChange }: { current: Mode; onChange: (m: Mode) => void }) {
  const btn = (label: string, value: Mode) => (
    <button
      key={value}
      onClick={() => onChange(value)}
      style={{
        background: current === value ? "rgba(255,255,255,0.22)" : "transparent",
        color: "#eaeaea",
        border: "none",
        padding: "6px 12px",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        letterSpacing: 0.5,
        cursor: "pointer",
        textTransform: "lowercase",
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      style={{
        position: "fixed",
        top: "max(12px, env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        borderRadius: 6,
        overflow: "hidden",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.12)",
        zIndex: 1000,
      }}
    >
      {btn("low poly", "city")}
      {btn("realistic", "realistic")}
    </div>
  );
}

export default App;

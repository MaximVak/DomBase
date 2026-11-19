"use client";
import { useEffect, useState } from "react";
import { kioskCopy, languageKey } from "./copy";
import type { KioskLanguage } from "./copy";

export default function KioskError() {
  const [language, setLanguage] = useState<KioskLanguage>("en");
  useEffect(() => {
    const retry = () => {
      if (!navigator.onLine) return;
      try {
        const key = "dombase-kiosk-reloaded-at";
        const previous = Number(sessionStorage.getItem(key));
        if (Date.now() - previous < 30000) return;
        sessionStorage.setItem(key, String(Date.now()));
      } catch { return; }
      window.location.reload();
    };
    const timer = window.setTimeout(() => {
      try { if (localStorage.getItem(languageKey) === "es") setLanguage("es"); } catch { /* Use the default copy. */ }
      retry();
    }, 1500);
    const interval = window.setInterval(retry, 30000);
    window.addEventListener("online", retry);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("online", retry); };
  }, []);
  const text = kioskCopy[language];
  return <main className="kiosk-screen" lang={language}><section className="kiosk-shell" aria-labelledby="kiosk-recovery-heading">
    <h1 id="kiosk-recovery-heading">{text.clock}</h1><p role="status">{text.recovery}</p>
    <button type="button" onClick={() => window.location.reload()}>{text.retry}</button>
  </section></main>;
}

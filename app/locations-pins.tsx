"use client";

import { useState } from "react";

export function LocationsPinsPanel({ locationName, pin }: { locationName: string; pin: string }) {
  const [showPin, setShowPin] = useState(false);

  return (
    <section className="panel settings-enforcement-panel settings-locations-pins-panel">
      <div className="settings-panel-heading"><h3>Locations &amp; PINs</h3></div>
      <table className="locations-pins-table">
        <thead><tr><th scope="col">Locations</th><th scope="col">Your PINs</th></tr></thead>
        <tbody>
          <tr>
            <td>{locationName}</td>
            <td>
              <div className="location-pin-value">
                <span>{pin ? (showPin ? pin : "******") : "Not set"}</span>
                <button type="button" disabled={!pin} aria-label={showPin ? "Hide PIN" : "Show PIN"}
                  aria-pressed={showPin} title={showPin ? "Hide PIN" : "Show PIN"}
                  onClick={() => setShowPin(current => !current)}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPin && <path d="M3 3l18 18" />}
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

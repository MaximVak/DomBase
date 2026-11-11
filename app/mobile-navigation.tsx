"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { ViewId } from "../workforce/model";
import { SidebarNavIcon } from "./sidebar-nav-icon";

type NavigationItem = { id: ViewId; label: string; icon: string };

export function MobileNavigation({ items, activeView, onNavigate }: {
  items: NavigationItem[];
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
}) {
  const moreRef = useRef<HTMLDetailsElement>(null);
  const primary = items.length > 5 ? items.slice(0, 4) : items;
  const extra = items.slice(primary.length);
  const navigate = (view: ViewId) => {
    if (moreRef.current?.open) {
      moreRef.current.querySelector("summary")?.focus();
      moreRef.current.open = false;
    }
    onNavigate(view);
  };
  const dismiss = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && moreRef.current?.open) {
      moreRef.current.open = false;
      moreRef.current.querySelector("summary")?.focus();
    }
  };

  return (
    <nav className="bottom-nav" aria-label="Mobile DomBase staff sections">
      {primary.map(item => (
        <button type="button" key={item.id}
          className={activeView === item.id ? "bottom-button active" : "bottom-button"}
          aria-current={activeView === item.id ? "page" : undefined}
          aria-label={item.id === "hours" ? "Hours (Timesheets)" : item.label}
          onClick={() => navigate(item.id)} title={item.label}>
          <SidebarNavIcon icon={item.icon} />
          <span>{item.id === "hours" ? "Hours" : item.label}</span>
        </button>
      ))}
      {extra.length > 0 && (
        <details className="mobile-more" ref={moreRef}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }}>
          <summary onKeyDown={dismiss} className={extra.some(item => item.id === activeView) ? "bottom-button active" : "bottom-button"}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            <span>More</span>
          </summary>
          <div className="mobile-more-links" aria-label="More sections">
            {extra.map(item => (
              <button type="button" key={item.id} onClick={() => navigate(item.id)} onKeyDown={dismiss}
                aria-current={activeView === item.id ? "page" : undefined}>
                <SidebarNavIcon icon={item.icon} /><span>{item.label}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}

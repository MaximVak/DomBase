export function SidebarNavIcon({ icon }: { icon: string }) {
  let paths;

  if (icon === "home") {
    paths = <><path d="m3.5 10.5 8.5-7 8.5 7" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" /></>;
  } else if (icon === "person") {
    paths = <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.7-4.3 3.2-6.5 7.5-6.5s6.8 2.2 7.5 6.5" /></>;
  } else if (icon === "calendar") {
    paths = <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M14 14h2M8 18h2M14 18h2" /></>;
  } else if (icon === "clock") {
    paths = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>;
  } else if (icon === "flag") {
    paths = <><path d="M5 22V3" /><path d="M5 4h11.5l-1.8 3 1.8 3H5" /></>;
  } else {
    paths = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>;
  }

  return (
    <span className="nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{paths}</svg>
    </span>
  );
}

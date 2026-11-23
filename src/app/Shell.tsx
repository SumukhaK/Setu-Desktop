import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type Page = "workspace" | "devices";

const navItems: Record<Page, { label: string; icon: IconName }> = {
  workspace: { label: "Workspace", icon: "grid" },
  devices: { label: "Devices", icon: "phone" },
};

export function Shell({
  page,
  onNavigate,
  items = ["workspace"],
  children,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  items?: readonly Page[];
  children: ReactNode;
}) {
  const main = useRef<HTMLElement>(null);
  const previous = useRef(page);

  useEffect(() => {
    if (previous.current === page) {
      return;
    }
    previous.current = page;
    main.current?.querySelector("h1")?.focus();
  }, [page]);

  return (
    <>
      <header className="chrome">
        <span className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          setu
          <span className="brand-period">.</span>
        </span>
      </header>
      <div className="shell">
        <aside className="rail">
          <div className="workspace-picker">
            <span className="workspace-glyph">
              <Icon name="laptop" size={20} />
            </span>
            <span>
              <strong>Solo</strong>
              <small>Solo mode</small>
            </span>
          </div>
          <nav aria-label="Workspace navigation" className="rail-nav">
            {items.map((item) => {
              const { label, icon } = navItems[item];
              const current = item === page;
              return (
                <button
                  key={item}
                  type="button"
                  className={current ? "nav-link active" : "nav-link"}
                  aria-current={current ? "page" : undefined}
                  onClick={() => {
                    onNavigate(item);
                  }}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main id="main" className="main-pane" tabIndex={-1} ref={main}>
          <div className="main-inner">{children}</div>
          <footer className="app-status">Setu-SDK v1.1.0</footer>
        </main>
      </div>
    </>
  );
}

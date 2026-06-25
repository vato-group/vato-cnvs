import { useStore } from "../store";
import { CLIS } from "../data/clis";
import type { WindowItem } from "../types";
import { useT } from "../i18n";

/** Startup prompt: relaunch last session's agents on their saved conversations. */
export function ResumeDialog() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const resumeAllAgents = useStore((s) => s.resumeAllAgents);
  const restartAgentsFresh = useStore((s) => s.restartAgentsFresh);
  const dismissResume = useStore((s) => s.dismissResume);

  const agents: Array<WindowItem & { wsName: string }> = workspaces.flatMap((w) =>
    w.windows
      .filter((win) => win.kind === "terminal" && win.resumable)
      .map((win) => ({ ...win, wsName: w.name })),
  );
  if (!agents.length) return null;

  const n = agents.length;
  return (
    <div className="vato-resume-overlay">
      <div className="vato-resume" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vato-resume-head">
          <h2>{t("resume.title")}</h2>
          <p>{t("resume.desc", { n })}</p>
        </div>

        <ul className="vato-resume-list">
          {agents.map((a) => {
            const def = a.cli ? CLIS[a.cli] : CLIS.shell;
            return (
              <li key={a.id}>
                <span className="ico" style={{ color: def.color }}>
                  <def.Icon size={16} />
                </span>
                <span className="name">{a.title}</span>
                <span className="meta">
                  {def.label}
                  {a.cwd ? ` · ${a.cwd}` : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="vato-resume-actions">
          <button className="vato-resume-btn primary" onClick={resumeAllAgents}>
            {t("resume.resumeAll")}
          </button>
          <button className="vato-resume-btn" onClick={restartAgentsFresh}>
            {t("resume.startFresh")}
          </button>
          <button className="vato-resume-btn ghost" onClick={dismissResume}>
            {t("resume.ignore")}
          </button>
        </div>
      </div>
    </div>
  );
}

import type { OpenProject, SessionListItem } from '../../protocol/types';
import { Header } from '../components/Header';
import { Glass } from '../components/Glass';
import { SessionRow } from '../components/SessionRow';
import { Icon } from '../components/icons';

/** 二级：某个项目的会话列表（照 App SessionsScreen）。 */
export function SessionsScreen({ project, sessions, onOpenArchive, onBack, onSwitchProject,
  onOpenSession, onLongPressSession, onNewSession }: {
  project: OpenProject | null;
  sessions: SessionListItem[];
  onOpenArchive: () => void;
  onBack: () => void;
  onSwitchProject: () => void;
  onOpenSession: (item: SessionListItem) => void;
  onLongPressSession: (item: SessionListItem) => void;
  onNewSession: () => void;
}): React.ReactElement {
  const visible = sessions.filter((item) => !item.archivedAt);
  return (
    <div className="screen">
      <Header
        onBack={onBack}
        title={
          <button type="button" className="project-title" onClick={onSwitchProject} aria-label="切换项目">
            <span className="project-title-chevron"><Icon name="chevronDown" size={14} /></span>
            <span className="project-title-text">{project?.name ?? '选择项目'}</span>
          </button>
        }
        right={
          <button type="button" className="header-pill-hit" onClick={onOpenArchive} aria-label="归档会话">
            <span className="header-pill-inner"><Icon name="clock" size={19} /></span>
          </button>
        }
      />
      <div className="screen-body sessions-body">
        {visible.length === 0 && <div className="list-empty">当前项目还没有会话</div>}
        {visible.map((session, index) => (
          <SessionRow key={session.sessionId} session={session} first={index === 0}
            onOpen={() => onOpenSession(session)} onMenu={() => onLongPressSession(session)} />
        ))}
      </div>
      {project && (
        <button type="button" className="fab" onClick={onNewSession} aria-label="新建会话">
          <Glass variant="frosted" contour radius={29} className="fab-glass">
            <span className="fab-inner"><Icon name="plusChat" size={24} /></span>
          </Glass>
        </button>
      )}
    </div>
  );
}

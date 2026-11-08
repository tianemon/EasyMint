import type { OpenProject, SessionListItem } from '../../protocol/types';
import type { ConnectionStatus } from '../../core/types';
import { Header } from '../components/Header';
import { SessionRow } from '../components/SessionRow';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export function SessionsScreen({ project, connection, sessions, refreshing, onRefresh,
  onOpenArchive, onBack, onSwitchProject, onOpenSession, onLongPressSession, onNewSession }: {
  project: OpenProject | null;
  connection: ConnectionStatus;
  sessions: SessionListItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpenArchive: () => void;
  onBack: () => void;
  onSwitchProject: () => void;
  onOpenSession: (item: SessionListItem) => void;
  onLongPressSession: (item: SessionListItem) => void;
  onNewSession: () => void;
}): React.ReactElement {
  const visible = sessions.filter((item) => !item.archivedAt);
  const archived = sessions.filter((item) => item.archivedAt);
  return (
    <div className="screen">
      <Header
        title={project?.name ?? t('app.sessions')}
        onTitleClick={onSwitchProject}
        showTitleChevron
        connected={connection === 'connected'}
        onBack={onBack}
        rightLabel={t('app.settings')}
        onRight={onOpenArchive}
      />
      <div className="screen-body sessions-body">
        <button type="button" className="sessions-refresh" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" size={13} /> {refreshing ? '刷新中…' : '下拉刷新'}
        </button>
        {visible.length === 0 && <div className="empty-hint">暂无会话</div>}
        {visible.map((session, index) => (
          <SessionRow key={session.sessionId} session={session} first={index === 0}
            onOpen={() => onOpenSession(session)} onMenu={() => onLongPressSession(session)} />
        ))}
        {archived.length > 0 && (
          <button type="button" className="archive-link" onClick={onOpenArchive}>
            <Icon name="archive" size={14} /> {t('app.archive')}（{archived.length}）
          </button>
        )}
      </div>
      <button type="button" className="fab" onClick={onNewSession} aria-label={t('app.newSession')}>
        <Icon name="plusChat" size={24} />
      </button>
    </div>
  );
}

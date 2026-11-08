import type { OpenProject } from '../../protocol/types';
import { Header } from '../components/Header';
import { Icon } from '../components/icons';
import { t } from '../i18n';

const STATUS_LABEL: Record<OpenProject['status'], string> = {
  setup: '准备中', development: '开发中', completed: '已完成',
};

export function ProjectsScreen({ projects, statusLabel, onBack, onOpenProject }: {
  projects: OpenProject[];
  statusLabel: string;
  onBack: () => void;
  onOpenProject: (item: OpenProject) => void;
}): React.ReactElement {
  return (
    <div className="screen">
      <Header title={t('app.projects')} onBack={onBack} right={<span className="header-status">{statusLabel}</span>} />
      <div className="screen-body">
        {projects.length === 0 && <div className="empty-hint">暂无打开的项目</div>}
        {projects.map((project, index) => (
          <div key={project.id} className="list-card">
            {index > 0 && <span className="list-divider" />}
            <button type="button" className="list-card-hit" onClick={() => onOpenProject(project)}>
              <span className="list-card-icon"><Icon name="folder" size={17} /></span>
              <span className="list-card-main">
                <span className="list-card-title">{project.name}</span>
                <span className="list-card-sub">{STATUS_LABEL[project.status]}</span>
              </span>
              <Icon name="chevron" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

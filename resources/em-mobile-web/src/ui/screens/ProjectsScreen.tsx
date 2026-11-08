import type { OpenProject } from '../../protocol/types';
import { Header } from '../components/Header';
import { Icon } from '../components/icons';

/** 电脑端打开的项目列表（照 App ProjectsScreen：纯文本行，状态显示原值）。 */
export function ProjectsScreen({ projects, statusLabel, onBack, onOpenProject }: {
  projects: OpenProject[];
  statusLabel: string;
  onBack: () => void;
  onOpenProject: (item: OpenProject) => void;
}): React.ReactElement {
  return (
    <div className="screen">
      <Header title="打开的项目" onBack={onBack} right={<span className="header-status">{statusLabel}</span>} />
      <div className="screen-body projects-body">
        {projects.length === 0 && <div className="list-empty">电脑端当前没有打开的项目</div>}
        {projects.map((project, index) => (
          <button key={project.id} type="button" className="project-row" onClick={() => onOpenProject(project)}>
            {index > 0 && <span className="divider-line" />}
            <span className="project-row-main">
              <span className="project-row-title">{project.name}</span>
              <span className="project-row-sub">{project.status}</span>
            </span>
            <Icon name="chevron" size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

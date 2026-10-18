import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { saveProjectDesign, projectDesignSection, readProjectDesign } from './project-design';
import { createProjectDesignTool } from './project-design-tool';
import { createPiSession, disposePiSession } from './pi-session';
import { Store } from './store';
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }));
const priorHome = process.env.EASYMINT_HOME, priorPi = process.env.PI_CODING_AGENT_DIR;
let root: string;
const sessions: Awaited<ReturnType<typeof createPiSession>>[] = [];
afterEach(async () => { for (const s of sessions.splice(0))
    await disposePiSession(s); if (root)
    fs.rmSync(root, { recursive: true, force: true }); if (priorHome === undefined)
    delete process.env.EASYMINT_HOME;
else
    process.env.EASYMINT_HOME = priorHome; if (priorPi === undefined)
    delete process.env.PI_CODING_AGENT_DIR;
else
    process.env.PI_CODING_AGENT_DIR = priorPi; });
it('hands the saved contract to the session and refreshes an already-open session after the real design tool updates files', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-visual-flow-'));
    const project = path.join(root, 'project'), agent = path.join(root, 'agent');
    fs.mkdirSync(project);
    fs.mkdirSync(agent);
    process.env.EASYMINT_HOME = root;
    process.env.PI_CODING_AGENT_DIR = agent;
    saveProjectDesign(project, { styleId: 'flat', layout: 'landing' }, 'technical', path.resolve('resources'));
    const definition = await createProjectDesignTool(project);
    const session = await createPiSession({ cwd: project, agentDir: agent, store: new Store(root), permissionMode: 'standard', canUseTool: async () => ({ behavior: 'allow' }), extraTools: [definition], systemPrompt: 'Main task' + projectDesignSection(project) });
    sessions.push(session);
    const before = await session.extensionRunner.emitBeforeAgentStart({ messageType: 'user', prompt: 'show project' }, { cwd: project, customPrompt: 'Main task' + projectDesignSection(project) });
    expect(JSON.stringify(before)).toContain('flat; palette');
    const tool = session.agent.state.tools.find(t => t.name === 'set_project_design')!;
    const result = await tool.execute('change', { styleId: 'glass', effect: 'subtle' }, new AbortController().signal);
    expect(JSON.stringify(result.content)).toContain('glass; palette');
    expect(readProjectDesign(project)?.selection.effect).toBe('subtle');
    const after = await session.extensionRunner.emitBeforeAgentStart({ messageType: 'custom', message: { role: 'custom', customType: 'test', content: 'continue', display: false, timestamp: Date.now() } }, { cwd: project, customPrompt: 'Main task' + projectDesignSection(project) });
    expect(JSON.stringify(after)).toContain('glass; palette');
    expect(JSON.stringify(after)).not.toContain('flat; palette');
    expect(fs.readFileSync(path.join(project, '.easymint/design/templates/template-landing.html'), 'utf8')).toContain('data-style="glass"');
    await tool.execute('brand', { brandId: 'apple' }, new AbortController().signal);
    expect(readProjectDesign(project)?.selection.brandId).toBe('apple');
    await tool.execute('palette', { palette: 'coral' }, new AbortController().signal);
    expect(readProjectDesign(project)?.selection.brandId).toBe('');
    expect(readProjectDesign(project)?.selection.palette).toBe('coral');
    for(const styleId of ['liquid-glass','claymorphism','business','luxury','bento','colorful','retro','soft','editorial','dark','tech']) {
        await tool.execute('new-direction',{styleId},new AbortController().signal);
        expect(readProjectDesign(project)?.selection.styleId).toBe(styleId);
        expect(fs.readFileSync(path.join(project,'.easymint/design/templates/template-landing.html'),'utf8')).toContain(`data-style="${styleId}"`);
    }
    const messagesBefore = session.agent.state.messages.length;
    fs.unlinkSync(path.join(project, '.easymint/design/theme.css'));
    await expect(session.prompt('generate')).rejects.toThrow('asset missing');
    await expect(session.sendCustomMessage({ customType: 'test', content: 'generate', display: false }, { triggerTurn: true })).rejects.toThrow('asset missing');
    expect(session.agent.state.messages).toHaveLength(messagesBefore);
});

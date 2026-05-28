import { BrowserWindow } from "electron";

interface TerminalSession {
  terminalId: string;
  pty: unknown; // node-pty IPty
  cwd: string;
}

export class AgentService {
  private terminals: Map<string, TerminalSession> = new Map();
  private terminalCounter = 0;

  createTerminal(cwd: string, _mainWindow: BrowserWindow): { terminalId: string } {
    // Will use node-pty to create real PTY
    // Stub: returns terminalId, actual PTY creation in task implementation
    const terminalId = `term-${++this.terminalCounter}`;
    this.terminals.set(terminalId, { terminalId, pty: null as unknown as TerminalSession["pty"], cwd });
    return { terminalId };
  }

  write(terminalId: string, _data: string): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).write(data);
    }
  }

  resize(terminalId: string, _cols: number, _rows: number): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).resize(cols, rows);
    }
  }

  destroyTerminal(terminalId: string): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).kill();
    }
    this.terminals.delete(terminalId);
  }

  resumeSession(_sessionId: string, _mainWindow: BrowserWindow): void {
    // Will create terminal and write `claude --resume <sessionId>`
  }
}

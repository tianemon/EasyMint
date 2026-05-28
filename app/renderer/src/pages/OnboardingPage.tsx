import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const STEPS = [
  { number: 1, title: "检测 Claude Code", description: "确认 Claude CLI 已安装并配置正确" },
  { number: 2, title: "确认配置", description: "检查配置信息是否正确" },
  { number: 3, title: "准备就绪", description: "EasyMint 已配置完成" },
];

const MOCK_SCAN_LINES = [
  { text: "$ which claude", delay: 500 },
  { text: "/usr/local/bin/claude", delay: 700 },
  { text: "$ claude --version", delay: 500 },
  { text: "Claude Code CLI v1.0.0", delay: 400 },
];

const MOCK_WORK_DIR = "/Users/amon";
const MOCK_AI_MODEL = "Claude Opus 4";

export function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanLines, setScanLines] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [detectedPath, setDetectedPath] = useState("/usr/local/bin/claude");
  const [detectedVersion, setDetectedVersion] = useState("1.0.0 (Claude Code CLI)");

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  const startScan = useCallback(() => {
    setIsScanning(true);
    setScanDone(false);
    setScanLines([]);
    setShowManualInput(false);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    let totalDelay = 0;
    MOCK_SCAN_LINES.forEach((line) => {
      totalDelay += line.delay;
      const t = setTimeout(() => {
        setScanLines((prev) => [...prev, line.text]);
      }, totalDelay);
      timersRef.current.push(t);
    });

    const done = setTimeout(() => {
      setIsScanning(false);
      setScanDone(true);
      setDetectedPath("/usr/local/bin/claude");
      setDetectedVersion("1.0.0 (Claude Code CLI)");
    }, totalDelay + 300);
    timersRef.current.push(done);
  }, []);

  const handleManualPathSubmit = () => {
    if (manualPath.trim()) {
      setDetectedPath(manualPath.trim());
      setDetectedVersion("未知（手动输入）");
      setScanDone(true);
      setShowManualInput(false);
    }
  };

  const handleComplete = () => {
    localStorage.setItem("easymint_setup_complete", "true");
    localStorage.setItem("easymint_cc_path", detectedPath);
    localStorage.setItem("easymint_cc_version", detectedVersion);
    navigate("/projects");
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="flex justify-center gap-3 pt-12 pb-2">
        {STEPS.map((step, i) => (
          <div key={step.number} className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                i < currentStep
                  ? "bg-accent"
                  : i === currentStep
                    ? "bg-accent ring-2 ring-accent/30"
                    : "bg-border"
              }`}
            />
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 h-[2px] transition-colors ${
                  i < currentStep ? "bg-accent" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
        <div className="w-full max-w-[480px]">
          <h1 className="text-xl font-semibold text-center mb-1">
            {STEPS[currentStep]!.title}
          </h1>
          <p className="text-text-secondary text-center text-sm mb-8">
            {STEPS[currentStep]!.description}
          </p>

          {currentStep === 0 && (
            <Step1Detect
              isScanning={isScanning}
              scanDone={scanDone}
              scanLines={scanLines}
              manualPath={manualPath}
              showManualInput={showManualInput}
              onManualPathChange={setManualPath}
              onShowManualInput={() => setShowManualInput(true)}
              onManualSubmit={handleManualPathSubmit}
              onStartScan={startScan}
            />
          )}

          {currentStep === 1 && (
            <Step2Confirm
              detectedPath={detectedPath}
              detectedVersion={detectedVersion}
              workDir={MOCK_WORK_DIR}
              aiModel={MOCK_AI_MODEL}
            />
          )}

          {currentStep === 2 && <Step3Done />}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border p-4 flex justify-between bg-surface-alt shrink-0">
        {!isLastStep ? (
          <>
            <button
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-30"
              disabled={currentStep === 0}
              onClick={goPrev}
            >
              返回
            </button>
            <button
              className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
              disabled={currentStep === 0 && !scanDone}
              onClick={goNext}
            >
              下一步
            </button>
          </>
        ) : (
          <>
            <button
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
              onClick={goPrev}
            >
              返回
            </button>
            <button
              className="px-6 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium"
              onClick={handleComplete}
            >
              进入工作台
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

// ---- Step 1: Detect Claude ----

function Step1Detect({
  isScanning,
  scanDone,
  scanLines,
  manualPath,
  showManualInput,
  onManualPathChange,
  onShowManualInput,
  onManualSubmit,
  onStartScan,
}: {
  isScanning: boolean;
  scanDone: boolean;
  scanLines: string[];
  manualPath: string;
  showManualInput: boolean;
  onManualPathChange: (v: string) => void;
  onShowManualInput: () => void;
  onManualSubmit: () => void;
  onStartScan: () => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      {/* Scan area */}
      <div
        className={`scan-area relative border-2 rounded-xl p-10 flex flex-col items-center justify-center gap-4 transition-all ${
          isScanning
            ? "border-accent border-solid bg-accent/5"
            : scanDone
              ? "border-accent border-solid bg-accent/5"
              : "border-dashed border-border bg-surface-alt/50"
        }`}
      >
        <div className={`text-3xl ${isScanning ? "scan-icon-spin" : ""}`}>
          {scanDone ? "✓" : "🔍"}
        </div>

        {!isScanning && !scanDone && (
          <>
            <p className="text-sm text-text-secondary text-center">
              点击下方按钮自动扫描系统中的 Claude CLI
            </p>
            <button
              className="px-6 py-2.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium"
              onClick={onStartScan}
            >
              开始扫描
            </button>
          </>
        )}

        {isScanning && (
          <p className="text-sm text-accent font-medium">正在扫描...</p>
        )}

        {scanDone && (
          <p className="text-sm text-accent font-medium">
            ✓ 已检测到 Claude CLI
          </p>
        )}
      </div>

      {/* Terminal output */}
      {scanLines.length > 0 && (
        <div className="terminal-output rounded-lg p-4 font-mono text-xs leading-relaxed overflow-hidden">
          {scanLines.map((line, i) => (
            <div
              key={i}
              className={`terminal-line ${
                line.startsWith("$") ? "text-text-secondary" : "text-accent"
              }`}
            >
              {line}
            </div>
          ))}
          {isScanning && <span className="terminal-cursor" />}
        </div>
      )}

      {/* Manual path input */}
      {scanDone && (
        <div className="text-center">
          <button
            className="text-xs text-text-secondary hover:text-accent underline transition-colors"
            onClick={onShowManualInput}
          >
            未检测到？手动输入路径
          </button>
        </div>
      )}

      {showManualInput && (
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={manualPath}
            onChange={(e) => onManualPathChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onManualSubmit()}
            placeholder="输入 Claude CLI 路径，如 /usr/local/bin/claude"
          />
          <button
            className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors text-sm disabled:opacity-40"
            disabled={!manualPath.trim()}
            onClick={onManualSubmit}
          >
            确认
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Step 2: Confirm ----

function Step2Confirm({
  detectedPath,
  detectedVersion,
  workDir,
  aiModel,
}: {
  detectedPath: string;
  detectedVersion: string;
  workDir: string;
  aiModel: string;
}): JSX.Element {
  const rows = [
    { label: "Claude CLI 路径", value: detectedPath },
    { label: "版本", value: detectedVersion },
    { label: "工作目录", value: workDir },
    { label: "AI 模型", value: aiModel },
  ];

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-center px-5 py-3.5 ${
            i < rows.length - 1 ? "border-b border-border" : ""
          } ${i % 2 === 0 ? "bg-surface-alt/50" : "bg-white"}`}
        >
          <span className="text-sm text-text-secondary w-32 shrink-0">
            {row.label}
          </span>
          <span className="text-sm text-text-primary font-mono">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Step 3: Done ----

function Step3Done(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
        <span className="text-3xl text-white">✓</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">EasyMint 已准备就绪</h2>
        <p className="text-sm text-text-secondary">
          Claude CLI 已配置完成，现在可以开始创建项目了
        </p>
      </div>
    </div>
  );
}

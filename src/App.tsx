import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { extractNamecardData, type OcrNamecardData } from './services/ocr';

type CameraStatus = 'idle' | 'loading' | 'ready' | 'failed';
type ViewMode = 'capture' | 'preview' | 'manual' | 'report';
type PipelineStepStatus = 'waiting' | 'running' | 'completed';
type OcrStatus = 'idle' | 'running' | 'success' | 'failed';

type ManualInput = {
  name: string;
  company: string;
  title: string;
  email: string;
  phone: string;
};

type ManualRequiredField = 'name' | 'company' | 'title';

type PipelineStepId = 'ocr' | 'person' | 'company' | 'merge' | 'score';

type PipelineStep = {
  id: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
};

type PipelinePayload = {
  source: 'camera' | 'manual';
  imageDataUrl?: string;
  namecardData: ManualInput;
};

type PipelineEvent = {
  type?: 'step_completed' | 'pipeline_done';
  step?: PipelineStepId;
  status?: 'completed';
};

const PIPELINE_STEP_META: Array<{ id: PipelineStepId; label: string }> = [
  { id: 'ocr', label: 'OCR' },
  { id: 'person', label: 'Person' },
  { id: 'company', label: 'Company' },
  { id: 'merge', label: 'Merge' },
  { id: 'score', label: 'Score' }
];

const INITIAL_MANUAL_INPUT: ManualInput = {
  name: '',
  company: '',
  title: '',
  email: '',
  phone: ''
};

const FIELD_LABELS: Record<ManualRequiredField, string> = {
  name: '名前',
  company: '会社',
  title: '役職'
};

function buildInitialPipelineSteps(): PipelineStep[] {
  return PIPELINE_STEP_META.map((step, index) => ({
    ...step,
    status: index === 0 ? 'running' : 'waiting'
  }));
}

function PipelineProgress({ steps, visible }: { steps: PipelineStep[]; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          className="pipeline-panel"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.22 }}
        >
          <div className="pipeline-title">Pipeline Progress</div>
          <ul className="pipeline-list">
            {steps.map((step, index) => (
              <motion.li
                key={step.id}
                className={`pipeline-item is-${step.status}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, delay: index * 0.06 }}
              >
                <motion.span
                  className="pipeline-dot"
                  animate={step.status === 'running' ? { scale: [1, 1.25, 1], opacity: [1, 0.65, 1] } : { scale: 1, opacity: 1 }}
                  transition={step.status === 'running' ? { duration: 1.1, repeat: Number.POSITIVE_INFINITY } : { duration: 0.15 }}
                />
                <span className="pipeline-label">{step.label}</span>
                <span className="pipeline-state">
                  {step.status === 'waiting' ? '待機' : step.status === 'running' ? '実行中...' : '完了'}
                </span>
              </motion.li>
            ))}
          </ul>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mockTimerRef = useRef<number[]>([]);

  const [statusText, setStatusText] = useState('カメラを起動します…');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [viewMode, setViewMode] = useState<ViewMode>('capture');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const [manualInput, setManualInput] = useState<ManualInput>(INITIAL_MANUAL_INPUT);
  const [manualErrors, setManualErrors] = useState<Partial<Record<ManualRequiredField, string>>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');
  const [ocrResult, setOcrResult] = useState<OcrNamecardData | null>(null);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(PIPELINE_STEP_META.map((step) => ({ ...step, status: 'waiting' as const })));

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const clearMockTimers = useCallback(() => {
    mockTimerRef.current.forEach((timerId) => window.clearTimeout(timerId));
    mockTimerRef.current = [];
  }, []);

  const finishPipeline = useCallback(() => {
    setStatusText('分析を開始しました');
    setIsAnalyzing(false);
    setViewMode('report');
    closeEventSource();
    clearMockTimers();
  }, [clearMockTimers, closeEventSource]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('failed');
      setStatusText('このブラウザではカメラAPIが使えません。画像を選択か手入力してください。');
      return;
    }

    setCameraStatus('loading');
    setStatusText('カメラを起動中…');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus('ready');
      setStatusText('カメラ起動中');
    } catch (error) {
      console.error(error);
      setCameraStatus('failed');
      setStatusText('カメラが使えません。画像を選択か手入力してください。');
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'capture') {
      void startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [viewMode, startCamera, stopCamera]);

  useEffect(() => {
    const handlePageHide = () => {
      stopCamera();
      closeEventSource();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [closeEventSource, stopCamera]);

  useEffect(() => {
    return () => {
      if (previewSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(previewSrc);
      }
      closeEventSource();
      clearMockTimers();
    };
  }, [clearMockTimers, closeEventSource, previewSrc]);

  const completeStep = useCallback((stepId: PipelineStepId) => {
    setPipelineSteps((prev) => {
      const currentIndex = prev.findIndex((step) => step.id === stepId);
      if (currentIndex < 0) return prev;

      const next = prev.map((step, index) => {
        if (index < currentIndex) return { ...step, status: 'completed' as const };
        if (index === currentIndex) return { ...step, status: 'completed' as const };
        if (index === currentIndex + 1) return { ...step, status: 'running' as const };
        return { ...step, status: 'waiting' as const };
      });

      return next;
    });
    if (stepId === 'score') {
      finishPipeline();
    }
  }, [finishPipeline]);

  const simulatePipelineProgress = useCallback(() => {
    clearMockTimers();
    PIPELINE_STEP_META.forEach((step, index) => {
      const timerId = window.setTimeout(() => completeStep(step.id), 850 * (index + 1));
      mockTimerRef.current.push(timerId);
    });
  }, [clearMockTimers, completeStep]);

  const startPipelineStream = useCallback((jobId: string) => {
    closeEventSource();

    const source = new EventSource(`/api/pipeline/events?jobId=${encodeURIComponent(jobId)}`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as PipelineEvent;
        if (payload.type === 'pipeline_done') {
          setPipelineSteps((prev) => prev.map((step) => ({ ...step, status: 'completed' })));
          finishPipeline();
          return;
        }

        const targetStep = payload.step;
        if (payload.type === 'step_completed' && targetStep) {
          completeStep(targetStep);
          return;
        }

        if (payload.status === 'completed' && targetStep) {
          completeStep(targetStep);
        }
      } catch {
        // noop: ignore malformed events
      }
    };

    source.onerror = () => {
      closeEventSource();
      setStatusText('SSE接続に失敗したため、ローカル進捗シミュレーションに切替えました');
      simulatePipelineProgress();
    };
  }, [closeEventSource, completeStep, finishPipeline, simulatePipelineProgress]);

  const startDdPipeline = async (payload: PipelinePayload) => {
    if (isAnalyzing) return;

    clearMockTimers();
    setIsAnalyzing(true);
    setPipelineSteps(buildInitialPipelineSteps());
    setStatusText('分析パイプラインを起動中…');

    try {
      const response = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('failed to start pipeline');
      }

      const body = (await response.json()) as { jobId?: string };
      if (!body.jobId) {
        throw new Error('missing jobId');
      }

      startPipelineStream(body.jobId);
    } catch (error) {
      console.warn('SSE start failed. falling back to mock progress.', error);
      simulatePipelineProgress();
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPreviewSrc(canvas.toDataURL('image/jpeg', 0.95));
    setViewMode('preview');
    setStatusText('画像を撮影しました');
  };

  const onPickImage = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  const onSelectImage: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      setPreviewSrc((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      setViewMode('preview');
      setStatusText('画像を選択しました');
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatusText('画像の読み込みに失敗しました。JPEG/PNG形式を選択してください。');
    };

    image.src = objectUrl;
    event.target.value = '';
  };

  const onRetake = () => {
    closeEventSource();
    clearMockTimers();
    setIsAnalyzing(false);
    setPipelineSteps(PIPELINE_STEP_META.map((step) => ({ ...step, status: 'waiting' })));
    setViewMode('capture');
    setStatusText('カメラを起動します…');
    setOcrStatus('idle');
    setOcrResult(null);
    setManualErrors({});
    setPreviewSrc((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const onStartManual = () => {
    setManualErrors({});
    setOcrStatus('idle');
    setOcrResult(null);
    setViewMode('manual');
    setStatusText('名前・会社・役職を入力して分析開始してください');
  };

  const onManualChange = (key: ManualRequiredField, value: string) => {
    setManualInput((prev) => ({ ...prev, [key]: value }));
    setManualErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validateManualInput = () => {
    const nextErrors: Partial<Record<ManualRequiredField, string>> = {};

    (Object.keys(FIELD_LABELS) as ManualRequiredField[]).forEach((key) => {
      if (!manualInput[key].trim()) {
        nextErrors[key] = `${FIELD_LABELS[key]}は必須です`;
      }
    });
    setManualErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onConfirmPreview = async () => {
    if (!previewSrc || isAnalyzing || isOcrRunning) return;

    setIsOcrRunning(true);
    setOcrStatus('running');
    setStatusText('OCR抽出中…');

    let mergedInput = manualInput;
    try {
      const ocrResult = await extractNamecardData(previewSrc);
      setOcrResult(ocrResult);
      setOcrStatus('success');
      mergedInput = {
        name: ocrResult.name ?? manualInput.name,
        company: ocrResult.company ?? manualInput.company,
        title: ocrResult.title ?? manualInput.title,
        email: ocrResult.email ?? manualInput.email,
        phone: ocrResult.phone ?? manualInput.phone
      };
      setManualInput(mergedInput);
      setStatusText('OCR抽出が完了しました。分析を開始します…');
    } catch (error) {
      console.warn('OCR extraction failed. continue with current input.', error);
      setOcrStatus('failed');
      setOcrResult(null);
      setStatusText('OCR抽出に失敗したため既存入力で分析を開始します');
    } finally {
      setIsOcrRunning(false);
    }

    await startDdPipeline({
      source: 'camera',
      imageDataUrl: previewSrc,
      namecardData: mergedInput
    });
  };

  const onStartFromManual = async () => {
    if (isAnalyzing || isOcrRunning) return;
    if (!validateManualInput()) {
      setStatusText('必須項目を入力してください');
      return;
    }

    await startDdPipeline({
      source: 'manual',
      namecardData: manualInput
    });
  };

  const sourceLinks = useMemo(() => {
    if (!report) return [];
    const unique = new Set<string>();
    report.dimensions.forEach((dimension) => {
      dimension.facts.forEach((fact) => {
        if (fact.sourceUrl) unique.add(fact.sourceUrl);
      });
    });
    return [...unique];
  }, [report]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title">名刺スキャン</div>
        <div className="status">{statusText}</div>
      </header>

      <PipelineProgress steps={pipelineSteps} visible={isAnalyzing} />

      {viewMode === 'capture' ? (
        <section className={`live ${cameraStatus === 'failed' ? 'no-camera' : ''}`}>
          <video ref={videoRef} id="camera" autoPlay playsInline muted />
          <div className="frame" aria-hidden="true" />
          <div className="hint">名刺を枠内に合わせてください</div>
          <button
            className="shutter"
            id="captureBtn"
            type="button"
            onClick={captureFrame}
            aria-label="撮影"
            disabled={isAnalyzing || isOcrRunning}
          />
          <div className="fallback">
            <button className="ghost-btn" id="pickImageBtn" type="button" onClick={onPickImage} disabled={isAnalyzing || isOcrRunning}>
              カメラが使えない? 画像を選択
            </button>
            <button className="ghost-btn" type="button" onClick={onStartManual} disabled={isAnalyzing || isOcrRunning}>
              手入力で開始
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={onSelectImage}
            />
          </div>
        </section>
      ) : null}

      {viewMode === 'preview' ? (
        <section className="preview">
          <img src={previewSrc ?? ''} alt="撮影した画像のプレビュー" />
          <div className="actions">
            <button className="ghost-btn" id="retakeBtn" type="button" onClick={onRetake} disabled={isAnalyzing || isOcrRunning}>
              再撮影
            </button>
            <button className="primary-btn" id="confirmBtn" type="button" onClick={onConfirmPreview} disabled={isAnalyzing || isOcrRunning}>
              {isOcrRunning ? 'OCR中…' : isAnalyzing ? '分析中…' : '分析開始'}
            </button>
          </div>
        </section>
      ) : null}

      {viewMode === 'manual' ? (
        <section className="manual">
          <form className="manual-form" onSubmit={(event) => event.preventDefault()}>
            {(Object.keys(FIELD_LABELS) as ManualRequiredField[]).map((key) => (
              <label className="field" key={key} htmlFor={`manual-${key}`}>
                <span className="field-label">{FIELD_LABELS[key]}</span>
                <input
                  id={`manual-${key}`}
                  value={manualInput[key]}
                  onChange={(event) => onManualChange(key, event.target.value)}
                  aria-invalid={Boolean(manualErrors[key])}
                />
                {manualErrors[key] ? <span className="field-error">{manualErrors[key]}</span> : null}
              </label>
            ))}

            <div className="manual-actions">
              <button className="ghost-btn" type="button" onClick={onRetake} disabled={isAnalyzing || isOcrRunning}>
                撮影に戻る
              </button>
              <button className="primary-btn" type="button" onClick={onStartFromManual} disabled={isAnalyzing || isOcrRunning}>
                {isAnalyzing ? '分析中…' : '分析開始'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {viewMode === 'report' ? (
        <section className="report" id="reportView">
          <div className="report-card">
            <h2>分析レポート</h2>
            <p className="report-note">パイプライン完了。入力データとOCR結果を確認できます。</p>
            <div className="report-grid">
              <div>
                <h3>入力データ</h3>
                <ul>
                  <li>名前: {manualInput.name || '-'}</li>
                  <li>会社: {manualInput.company || '-'}</li>
                  <li>役職: {manualInput.title || '-'}</li>
                  <li>email: {manualInput.email || '-'}</li>
                  <li>phone: {manualInput.phone || '-'}</li>
                </ul>
              </div>
              <div>
                <h3>OCR結果</h3>
                <p>
                  状態:
                  {' '}
                  {ocrStatus === 'success'
                    ? '成功'
                    : ocrStatus === 'failed'
                      ? '失敗'
                      : ocrStatus === 'running'
                        ? '実行中'
                        : '未実行'}
                </p>
                <ul>
                  <li>name: {ocrResult?.name ?? '-'}</li>
                  <li>company: {ocrResult?.company ?? '-'}</li>
                  <li>title: {ocrResult?.title ?? '-'}</li>
                  <li>email: {ocrResult?.email ?? '-'}</li>
                  <li>phone: {ocrResult?.phone ?? '-'}</li>
                </ul>
              </div>
            </div>
            <div className="manual-actions">
              <button className="ghost-btn" type="button" onClick={onRetake}>
                新しくスキャン
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;

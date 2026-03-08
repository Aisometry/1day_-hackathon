import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEventHandler } from 'react';

type CameraStatus = 'idle' | 'loading' | 'ready' | 'failed';
type ViewMode = 'capture' | 'preview' | 'manual' | 'report';
type PipelineStepStatus = 'waiting' | 'running' | 'completed';

type PipelineStepId = 'ocr' | 'person' | 'company' | 'merge' | 'score';

type PipelineStep = {
  id: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
};

type ManualInput = {
  name: string;
  company: string;
  title: string;
};

type ManualField = keyof ManualInput;

type PipelinePayload = {
  source: 'camera' | 'manual';
  imageDataUrl?: string;
  namecardData: ManualInput;
};

type PipelineEvent = {
  type?: 'connected' | 'step_completed' | 'pipeline_done';
  step?: PipelineStepId;
  status?: 'completed';
};

type FactItem = {
  label: string;
  value: string;
  sourceUrl?: string;
};

type DimensionReport = {
  id: string;
  label: string;
  score: number;
  summary: string;
  facts: FactItem[];
};

type CompatibilityReport = {
  name: string;
  company: string;
  totalScore: number;
  dimensions: DimensionReport[];
  recommendations: string[];
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
  title: ''
};

const FIELD_LABELS: Record<ManualField, string> = {
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

function buildDummyReport(input: ManualInput): CompatibilityReport {
  const name = input.name || '岩辺達也';
  const company = input.company || 'SanSan株式会社';

  const dimensions: DimensionReport[] = [
    {
      id: 'industry-fit',
      label: '業界適合度',
      score: 84,
      summary: 'SaaS/営業DX文脈での親和性が高い。',
      facts: [
        {
          label: '企業カテゴリ',
          value: 'SalesTech / B2B SaaS',
          sourceUrl: 'https://www.crustdata.com/'
        },
        {
          label: '推定導入余地',
          value: '高',
          sourceUrl: 'https://www.crustdata.com/'
        }
      ]
    },
    {
      id: 'role-fit',
      label: '役職適合度',
      score: 78,
      summary: 'SMB営業部門のため意思決定への距離が短い。',
      facts: [
        {
          label: '部署',
          value: input.title || 'SMB第3営業部',
          sourceUrl: 'https://www.crustdata.com/'
        },
        {
          label: '決裁関与推定',
          value: '中〜高'
        }
      ]
    },
    {
      id: 'timing',
      label: '導入タイミング',
      score: 73,
      summary: '短期接触よりも複数接点での提案が有効。',
      facts: [
        {
          label: '成長フェーズ',
          value: '拡大期',
          sourceUrl: 'https://www.crustdata.com/'
        },
        {
          label: '直近トピック',
          value: '営業生産性向上施策',
          sourceUrl: 'https://www.crustdata.com/'
        }
      ]
    },
    {
      id: 'contactability',
      label: '接触可能性',
      score: 91,
      summary: 'メール/電話の接触導線が確保されている。',
      facts: [
        {
          label: 'メール',
          value: 'iwanabe@sansan.com',
          sourceUrl: 'https://www.crustdata.com/'
        },
        {
          label: '電話',
          value: '03-6419-3033'
        }
      ]
    },
    {
      id: 'data-confidence',
      label: 'データ信頼度',
      score: 76,
      summary: '主要項目は一致、電話は追加検証余地あり。',
      facts: [
        {
          label: 'OCR一致率',
          value: '88%',
          sourceUrl: 'https://www.crustdata.com/'
        },
        {
          label: '未検証項目数',
          value: '1'
        }
      ]
    }
  ];

  const totalScore = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length);

  return {
    name,
    company,
    totalScore,
    dimensions,
    recommendations: [
      '初回は「SMB営業の業務効率化」を主題に15分商談を提案する',
      '1営業日以内に要点3つのフォローアップメールを送る',
      '未検証の電話番号は次回接触時に確認してデータ更新する'
    ]
  };
}

function PipelineProgress({ steps, visible }: { steps: PipelineStep[]; visible: boolean }) {
  if (!visible) return null;

  return (
    <aside className="pipeline-panel">
      <div className="pipeline-title">Pipeline Progress</div>
      <ul className="pipeline-list">
        {steps.map((step) => (
          <li key={step.id} className={`pipeline-item is-${step.status}`}>
            <span className="pipeline-dot" />
            <span className="pipeline-label">{step.label}</span>
            <span className="pipeline-state">
              {step.status === 'waiting' ? '待機' : step.status === 'running' ? '実行中...' : '完了'}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RadarChart({ dimensions }: { dimensions: DimensionReport[] }) {
  const size = 320;
  const center = size / 2;
  const radius = 118;
  const angleStep = (Math.PI * 2) / dimensions.length;

  const points = dimensions
    .map((dimension, index) => {
      const angle = -Math.PI / 2 + angleStep * index;
      const r = (Math.max(0, Math.min(100, dimension.score)) / 100) * radius;
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="radar-wrap" role="img" aria-label="5次元レーダーチャート">
      <svg viewBox={`0 0 ${size} ${size}`} className="radar-svg">
        {[0.25, 0.5, 0.75, 1].map((scale) => {
          const ring = dimensions
            .map((_, index) => {
              const angle = -Math.PI / 2 + angleStep * index;
              const x = center + Math.cos(angle) * radius * scale;
              const y = center + Math.sin(angle) * radius * scale;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return <polygon key={scale} points={ring} className="radar-ring" />;
        })}

        {dimensions.map((_, index) => {
          const angle = -Math.PI / 2 + angleStep * index;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          return <line key={index} x1={center} y1={center} x2={x} y2={y} className="radar-axis" />;
        })}

        <polygon points={points} className="radar-area" />

        {dimensions.map((dimension, index) => {
          const angle = -Math.PI / 2 + angleStep * index;
          const x = center + Math.cos(angle) * (radius + 22);
          const y = center + Math.sin(angle) * (radius + 22);
          return (
            <text key={dimension.id} x={x} y={y} className="radar-label" textAnchor="middle" dominantBaseline="middle">
              {dimension.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<number[]>([]);
  const reportTransitionTimerRef = useRef<number | null>(null);

  const [statusText, setStatusText] = useState('カメラを起動します…');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [viewMode, setViewMode] = useState<ViewMode>('capture');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const [manualInput, setManualInput] = useState<ManualInput>(INITIAL_MANUAL_INPUT);
  const [manualErrors, setManualErrors] = useState<Partial<Record<ManualField, string>>>({});

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(
    PIPELINE_STEP_META.map((step) => ({ ...step, status: 'waiting' as const }))
  );
  const [report, setReport] = useState<CompatibilityReport | null>(null);

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearFallbackTimers = useCallback(() => {
    fallbackTimerRef.current.forEach((id) => window.clearTimeout(id));
    fallbackTimerRef.current = [];
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const clearReportTransitionTimer = useCallback(() => {
    if (reportTransitionTimerRef.current !== null) {
      window.clearTimeout(reportTransitionTimerRef.current);
      reportTransitionTimerRef.current = null;
    }
  }, []);

  const resetPipelineState = useCallback(() => {
    clearFallbackTimers();
    clearReportTransitionTimer();
    closeEventSource();
    setIsAnalyzing(false);
    setPipelineSteps(PIPELINE_STEP_META.map((step) => ({ ...step, status: 'waiting' as const })));
  }, [clearFallbackTimers, clearReportTransitionTimer, closeEventSource]);

  const queueReportTransition = useCallback((input: ManualInput) => {
    clearReportTransitionTimer();
    setStatusText('レポートを生成中…');
    reportTransitionTimerRef.current = window.setTimeout(() => {
      setReport(buildDummyReport(input));
      setViewMode('report');
      setIsAnalyzing(false);
      reportTransitionTimerRef.current = null;
    }, 500);
  }, [clearReportTransitionTimer]);

  const completeStep = useCallback((stepId: PipelineStepId, inputForReport: ManualInput) => {
    setPipelineSteps((prev) => {
      const index = prev.findIndex((step) => step.id === stepId);
      if (index < 0) return prev;

      return prev.map((step, i) => {
        if (i < index) return { ...step, status: 'completed' as const };
        if (i === index) return { ...step, status: 'completed' as const };
        if (i === index + 1) return { ...step, status: 'running' as const };
        return { ...step, status: 'waiting' as const };
      });
    });

    if (stepId === 'score') {
      queueReportTransition(inputForReport);
    }
  }, [queueReportTransition]);

  const simulatePipeline = useCallback((inputForReport: ManualInput) => {
    clearFallbackTimers();
    PIPELINE_STEP_META.forEach((step, index) => {
      const timer = window.setTimeout(() => {
        completeStep(step.id, inputForReport);
      }, 1000 * (index + 1));
      fallbackTimerRef.current.push(timer);
    });
  }, [clearFallbackTimers, completeStep]);

  const startPipelineStream = useCallback((jobId: string, inputForReport: ManualInput) => {
    closeEventSource();

    const source = new EventSource(`/api/pipeline/events?jobId=${encodeURIComponent(jobId)}`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as PipelineEvent;

        if (payload.type === 'step_completed' && payload.step) {
          completeStep(payload.step, inputForReport);
          return;
        }

        if (payload.type === 'pipeline_done') {
          setPipelineSteps((prev) => prev.map((step) => ({ ...step, status: 'completed' as const })));
          queueReportTransition(inputForReport);
        }
      } catch {
        // ignore malformed event payload
      }
    };

    source.onerror = () => {
      closeEventSource();
      setStatusText('SSE接続に失敗したためモック進捗に切替えました');
      simulatePipeline(inputForReport);
    };
  }, [closeEventSource, completeStep, queueReportTransition, simulatePipeline]);

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
    const onPageHide = () => {
      stopCamera();
      resetPipelineState();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [resetPipelineState, stopCamera]);

  useEffect(() => {
    return () => {
      if (previewSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(previewSrc);
      }
      resetPipelineState();
    };
  }, [previewSrc, resetPipelineState]);

  const startDdPipeline = async (payload: PipelinePayload) => {
    if (isAnalyzing) return;

    setReport(null);
    clearReportTransitionTimer();
    clearFallbackTimers();
    closeEventSource();

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

      startPipelineStream(body.jobId, payload.namecardData);
    } catch (error) {
      console.warn('Pipeline start failed. using local mock progress.', error);
      simulatePipeline(payload.namecardData);
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
    resetPipelineState();
    setViewMode('capture');
    setStatusText('カメラを起動します…');
    setReport(null);
    setManualErrors({});
    setPreviewSrc((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const onStartManual = () => {
    setManualErrors({});
    setViewMode('manual');
    setStatusText('名前・会社・役職を入力して分析開始してください');
  };

  const onManualChange = (key: ManualField, value: string) => {
    setManualInput((prev) => ({ ...prev, [key]: value }));
    setManualErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validateManualInput = () => {
    const nextErrors: Partial<Record<ManualField, string>> = {};
    (Object.keys(FIELD_LABELS) as ManualField[]).forEach((key) => {
      if (!manualInput[key].trim()) {
        nextErrors[key] = `${FIELD_LABELS[key]}は必須です`;
      }
    });
    setManualErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onConfirmPreview = async () => {
    if (!previewSrc || isAnalyzing) return;
    await startDdPipeline({
      source: 'camera',
      imageDataUrl: previewSrc,
      namecardData: manualInput
    });
  };

  const onStartFromManual = async () => {
    if (isAnalyzing) return;
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
          <button className="shutter" type="button" onClick={captureFrame} aria-label="撮影" disabled={isAnalyzing} />
          <div className="fallback">
            <button className="ghost-btn" type="button" onClick={onPickImage} disabled={isAnalyzing}>
              カメラが使えない? 画像を選択
            </button>
            <button className="ghost-btn" type="button" onClick={onStartManual} disabled={isAnalyzing}>
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
            <button className="ghost-btn" type="button" onClick={onRetake} disabled={isAnalyzing}>
              再撮影
            </button>
            <button className="primary-btn" type="button" onClick={onConfirmPreview} disabled={isAnalyzing}>
              {isAnalyzing ? '分析中…' : '分析開始'}
            </button>
          </div>
        </section>
      ) : null}

      {viewMode === 'manual' ? (
        <section className="manual">
          <form className="manual-form" onSubmit={(event) => event.preventDefault()}>
            {(Object.keys(FIELD_LABELS) as ManualField[]).map((key) => (
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
              <button className="ghost-btn" type="button" onClick={onRetake} disabled={isAnalyzing}>
                撮影に戻る
              </button>
              <button className="primary-btn" type="button" onClick={onStartFromManual} disabled={isAnalyzing}>
                {isAnalyzing ? '分析中…' : '分析開始'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {viewMode === 'report' && report ? (
        <section className="report is-visible">
          <article className="report-card">
            <header className="report-header">
              <div>
                <h2>{report.name}</h2>
                <p>{report.company}</p>
              </div>
              <div className="report-score">
                <span>Compatibility Score</span>
                <strong>{report.totalScore}</strong>
              </div>
            </header>

            <RadarChart dimensions={report.dimensions} />

            <section className="detail-grid">
              {report.dimensions.map((dimension) => (
                <article key={dimension.id} className="detail-card">
                  <div className="detail-head">
                    <h3>{dimension.label}</h3>
                    <span className="detail-score">{dimension.score}</span>
                  </div>
                  <p className="detail-summary">{dimension.summary}</p>
                  <ul className="fact-list">
                    {dimension.facts.map((fact, index) => (
                      <li key={`${dimension.id}-${index}`}>
                        <span className="fact-label">{fact.label}</span>
                        <span className="fact-value">{fact.value}</span>
                        {fact.sourceUrl ? (
                          <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="fact-link">
                            根拠リンク
                          </a>
                        ) : (
                          <span className="fact-unverified">未検証</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>

            <section className="recommend-card">
              <h3>推奨アクション</h3>
              <ol>
                {report.recommendations.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </section>

            <section className="source-card">
              <h3>ソースリンク（根拠）</h3>
              {sourceLinks.length ? (
                <ul>
                  {sourceLinks.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer">{url}</a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>未検証</p>
              )}
            </section>

            <div className="manual-actions">
              <button className="ghost-btn" type="button" onClick={onRetake}>
                新しくスキャン
              </button>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}

export default App;

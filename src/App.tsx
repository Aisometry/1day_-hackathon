import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from 'react';

type CameraStatus = 'idle' | 'loading' | 'ready' | 'failed';
type ViewMode = 'capture' | 'preview' | 'manual';

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

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [statusText, setStatusText] = useState('カメラを起動します…');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [viewMode, setViewMode] = useState<ViewMode>('capture');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const [manualInput, setManualInput] = useState<ManualInput>(INITIAL_MANUAL_INPUT);
  const [manualErrors, setManualErrors] = useState<Partial<Record<ManualField, string>>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

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
    const handlePageHide = () => stopCamera();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      if (previewSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(previewSrc);
      }
    };
  }, [previewSrc]);

  const startDdPipeline = async (payload: PipelinePayload) => {
    setIsAnalyzing(true);
    setStatusText('分析パイプラインを起動中…');

    try {
      // TODO: 実API接続時に置き換える
      await new Promise((resolve) => setTimeout(resolve, 1200));
      console.log('DD pipeline payload:', payload);
      setStatusText('分析を開始しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

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
      setPreviewSrc((old) => {
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
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
    setViewMode('capture');
    setStatusText('カメラを起動します…');
    setManualErrors({});
    setPreviewSrc((old) => {
      if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
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

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title">名刺スキャン</div>
        <div className="status" id="status">{statusText}</div>
      </header>

      {viewMode === 'capture' ? (
        <section className={`live ${cameraStatus === 'failed' ? 'no-camera' : ''}`} id="liveView">
          <video ref={videoRef} id="camera" autoPlay playsInline muted />
          <div className="frame" aria-hidden="true" />
          <div className="hint">名刺を枠内に合わせてください</div>
          <button
            className="shutter"
            id="captureBtn"
            type="button"
            onClick={captureFrame}
            aria-label="撮影"
            disabled={isAnalyzing}
          />
          <div className="fallback">
            <button className="ghost-btn" id="pickImageBtn" type="button" onClick={onPickImage} disabled={isAnalyzing}>
              カメラが使えない? 画像を選択
            </button>
            <button className="ghost-btn" type="button" onClick={onStartManual} disabled={isAnalyzing}>
              手入力で開始
            </button>
            <input
              ref={fileInputRef}
              type="file"
              id="fileInput"
              accept="image/*"
              className="visually-hidden"
              onChange={onSelectImage}
            />
          </div>
        </section>
      ) : null}

      {viewMode === 'preview' ? (
        <section className="preview" id="previewView">
          <img id="previewImage" src={previewSrc ?? ''} alt="撮影した画像のプレビュー" />
          <div className="actions">
            <button className="ghost-btn" id="retakeBtn" type="button" onClick={onRetake} disabled={isAnalyzing}>
              再撮影
            </button>
            <button className="primary-btn" id="confirmBtn" type="button" onClick={onConfirmPreview} disabled={isAnalyzing}>
              {isAnalyzing ? '分析中…' : '分析開始'}
            </button>
          </div>
        </section>
      ) : null}

      {viewMode === 'manual' ? (
        <section className="manual" id="manualView">
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
    </main>
  );
}

export default App;

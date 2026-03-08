import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from 'react';

type CameraStatus = 'idle' | 'loading' | 'ready' | 'failed';
type Step = 'capture' | 'preview' | 'edit';

type NamecardData = {
  name: string;
  company: string;
  department: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  website: string;
};

type FieldKey = keyof NamecardData;

const REQUIRED_FIELDS: FieldKey[] = ['name', 'company', 'email'];

const FIELD_LABELS: Record<FieldKey, string> = {
  name: '氏名',
  company: '会社名',
  department: '部署',
  title: '役職',
  email: 'メール',
  phone: '電話番号',
  address: '住所',
  website: 'Webサイト'
};

const INITIAL_DATA: NamecardData = {
  name: '',
  company: '',
  department: '',
  title: '',
  email: '',
  phone: '',
  address: '',
  website: ''
};

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [statusText, setStatusText] = useState('カメラを起動します…');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [step, setStep] = useState<Step>('capture');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [formData, setFormData] = useState<NamecardData>(INITIAL_DATA);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('failed');
      setStatusText('このブラウザではカメラAPIが使えません。画像を選択してください。');
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
      setStatusText('カメラが使えません。画像を選択してください。');
    }
  }, []);

  useEffect(() => {
    if (step === 'capture') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [step, startCamera, stopCamera]);

  useEffect(() => {
    const handlePageHide = () => stopCamera();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [stopCamera]);

  const updatePreview = (src: string, nextStatus: string) => {
    setPreviewSrc((old) => {
      if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
      return src;
    });
    setStep('preview');
    setStatusText(nextStatus);
    stopCamera();
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
    updatePreview(canvas.toDataURL('image/jpeg', 0.95), '画像を撮影しました');
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
      updatePreview(objectUrl, '画像を選択しました');
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatusText('画像の読み込みに失敗しました。JPEG/PNG形式を選択してください。');
    };

    image.src = objectUrl;
    event.target.value = '';
  };

  const onRetake = () => {
    setStep('capture');
    setStatusText('カメラを起動します…');
  };

  const onConfirmImage = () => {
    setErrors({});
    // OCRの仮結果として、編集しやすい初期値を投入
    setFormData((prev) => ({
      ...prev,
      name: prev.name || '山田 太郎',
      company: prev.company || '株式会社サンプル',
      department: prev.department || '営業部',
      title: prev.title || 'マネージャー',
      email: prev.email || 'taro.yamada@example.com',
      phone: prev.phone || '03-1234-5678',
      address: prev.address || '東京都千代田区1-1-1',
      website: prev.website || 'https://example.com'
    }));
    setStep('edit');
    setStatusText('OCR結果を確認して分析を開始してください');
  };

  const onChangeField = (key: FieldKey, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = () => {
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    REQUIRED_FIELDS.forEach((key) => {
      if (!formData[key].trim()) {
        nextErrors[key] = `${FIELD_LABELS[key]}は必須です`;
      }
    });

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      nextErrors.email = 'メール形式が正しくありません';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const runPipeline = async () => {
    if (!validate()) {
      setStatusText('必須項目を入力してください');
      return;
    }

    setIsAnalyzing(true);
    setStatusText('分析パイプラインを起動中…');

    try {
      // 実API連携前のダミー処理
      await new Promise((resolve) => setTimeout(resolve, 1200));
      console.log('Pipeline input:', formData);
      setStatusText('分析を開始しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (previewSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(previewSrc);
      }
    };
  }, [previewSrc]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title">名刺スキャン</div>
        <div className="status" id="status">{statusText}</div>
      </header>

      {step === 'capture' ? (
        <section className={`live ${cameraStatus === 'failed' ? 'no-camera' : ''}`} id="liveView">
          <video ref={videoRef} id="camera" autoPlay playsInline muted />
          <div className="frame" aria-hidden="true" />
          <div className="hint">名刺を枠内に合わせてください</div>
          <button className="shutter" id="captureBtn" type="button" onClick={captureFrame} aria-label="撮影" />
          <div className="fallback">
            <button className="ghost-btn" id="pickImageBtn" type="button" onClick={onPickImage}>
              カメラが使えない? 画像を選択
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

      {step === 'preview' ? (
        <section className="preview" id="previewView">
          <img id="previewImage" src={previewSrc ?? ''} alt="撮影した画像のプレビュー" />
          <div className="actions">
            <button className="ghost-btn" id="retakeBtn" type="button" onClick={onRetake}>
              再撮影
            </button>
            <button className="primary-btn" id="confirmBtn" type="button" onClick={onConfirmImage}>
              確定
            </button>
          </div>
        </section>
      ) : null}

      {step === 'edit' ? (
        <section className="editor" id="editorView">
          <div className="editor-preview-wrap">
            <img className="editor-preview" src={previewSrc ?? ''} alt="OCR対象の名刺画像" />
          </div>

          <form className="editor-form" onSubmit={(event) => event.preventDefault()}>
            {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
              <label className="field" key={key} htmlFor={`field-${key}`}>
                <span className="field-label">
                  {FIELD_LABELS[key]}
                  {REQUIRED_FIELDS.includes(key) ? <em>必須</em> : null}
                </span>
                <input
                  id={`field-${key}`}
                  value={formData[key]}
                  onChange={(event) => onChangeField(key, event.target.value)}
                  aria-invalid={Boolean(errors[key])}
                />
                {errors[key] ? <span className="field-error">{errors[key]}</span> : null}
              </label>
            ))}

            <div className="editor-actions">
              <button className="ghost-btn" type="button" onClick={onRetake} disabled={isAnalyzing}>
                再撮影
              </button>
              <button className="primary-btn" type="button" onClick={runPipeline} disabled={isAnalyzing}>
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

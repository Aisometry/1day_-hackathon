import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from 'react';

type CameraStatus = 'idle' | 'loading' | 'ready' | 'failed';

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [statusText, setStatusText] = useState('カメラを起動します…');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);

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
    if (!isPreview) {
      void startCamera();
    }
    return () => stopCamera();
  }, [isPreview, startCamera, stopCamera]);

  useEffect(() => {
    const handlePageHide = () => stopCamera();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [stopCamera]);

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
    setIsPreview(true);
    stopCamera();
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
      setIsPreview(true);
      setStatusText('画像を選択しました');
      stopCamera();
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatusText('画像の読み込みに失敗しました。JPEG/PNG形式を選択してください。');
    };

    image.src = objectUrl;
    event.target.value = '';
  };

  const onRetake = () => {
    setIsPreview(false);
    setPreviewSrc((old) => {
      if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
      return null;
    });
    setStatusText('カメラを起動します…');
  };

  const onConfirm = () => {
    if (!previewSrc) return;
    const link = document.createElement('a');
    link.href = previewSrc;
    link.download = `business-card-${Date.now()}.jpg`;
    link.click();
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

      {!isPreview ? (
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
      ) : (
        <section className="preview" id="previewView">
          <img id="previewImage" src={previewSrc ?? ''} alt="撮影した画像のプレビュー" />
          <div className="actions">
            <button className="ghost-btn" id="retakeBtn" type="button" onClick={onRetake}>
              再撮影
            </button>
            <button className="primary-btn" id="confirmBtn" type="button" onClick={onConfirm}>
              確定
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;

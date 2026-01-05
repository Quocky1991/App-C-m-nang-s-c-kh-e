
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppMode, HealthHandbook, HealthSlide, HealthLink, HealthAsset, HEALTH_CATEGORIES, VOICE_OPTIONS } from './types';
import { 
  generateHealthContent, 
  generateHealthImage, 
  generateHealthVoice, 
  decodeAudio 
} from './services/geminiService';
import { 
  saveHandbookToDB, 
  getAllHandbooks, 
  deleteHandbookFromDB,
  getAllAssets,
  saveAssetToDB,
  deleteAssetFromDB,
  requestPersistence
} from './services/storageService';

type ExportStatus = 'idle' | 'preparing' | 'recording' | 'saving' | 'success' | 'error';
type SortOption = 'date-desc' | 'date-asc' | 'title-asc' | 'category-asc';

type SlideSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface SlideSyncInfo {
  status: SlideSyncStatus;
  error?: string;
  progressMessage?: string;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'update' | 'reminder' | 'info';
  timestamp: number;
  read: boolean;
}

interface VideoExportConfig {
  resolution: '720p' | '1080p';
  fps: number;
  codec: string;
  format: 'mp4' | 'webm';
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

const PRESET_MUSIC = [
  { id: 'none', name: 'Không nhạc', url: '', icon: 'fa-volume-mute' },
  { id: 'ambient', name: 'Ambient Healing', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', icon: 'fa-leaf' },
  { id: 'inspiring', name: 'Pulse of Health', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', icon: 'fa-heartbeat' },
  { id: 'piano', name: 'Deep Relax', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', icon: 'fa-moon' },
  { id: 'corporate', name: 'Clinical Soft', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', icon: 'fa-stethoscope' }
];

const PRESET_SFX = [
  { id: 'none', name: 'Không SFX', url: '', icon: 'fa-ban' },
  { id: 'swoosh', name: 'Gió lướt', url: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3', icon: 'fa-wind' },
  { id: 'chime', name: 'Chuông nhẹ', url: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3', icon: 'fa-bell' },
  { id: 'pop', name: 'Bật mở', url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', icon: 'fa-magic' },
  { id: 'digital', name: 'Công nghệ', url: 'https://assets.mixkit.co/active_storage/sfx/2591/2591-preview.mp3', icon: 'fa-microchip' }
];

const FONT_OPTIONS = [
  { id: 'Poppins', name: 'Hiện đại (Poppins)' },
  { id: 'Georgia', name: 'Cổ điển (Serif)' },
  { id: 'Arial', name: 'Tiêu chuẩn (Sans)' },
  { id: 'Verdana', name: 'Rõ nét (Verdana)' },
  { id: 'Courier New', name: 'Máy đánh chữ' }
];

const MAX_HISTORY = 30;

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.SETUP);
  const [setupData, setSetupData] = useState({ 
    topic: '', 
    category: HEALTH_CATEGORIES[0], 
    voice: VOICE_OPTIONS[0].id,
    bgMusicUrl: PRESET_MUSIC[1].url,
    transitionSoundUrl: PRESET_SFX[1].url,
    intro: 'Chào mừng bạn đến với cẩm nang sức khỏe. Hôm nay chúng ta sẽ tìm hiểu về...', 
    outro: 'Chúc bạn luôn mạnh khỏe và bình an. Hãy theo dõi để biết thêm nhiều mẹo hữu ích nhé!' 
  });
  
  const [textConfig, setTextConfig] = useState({
    fontSize: 26,
    fontFamily: 'Poppins',
    position: 'bottom' as 'top' | 'bottom',
    opacity: 0.7
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animationStartTimeRef = useRef<number>(0);
  const bgMusicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bgMusicGainRef = useRef<GainNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordingSlideId, setRecordingSlideId] = useState<string | null>(null);

  const availableCodecs = useMemo(() => {
    const all = [
      { label: 'WebM (VP9) - High Quality', mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { label: 'WebM (VP8) - Standard', mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { label: 'MP4 (AVC) - Universal', mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    ];
    if (typeof MediaRecorder === 'undefined') return [];
    return all.filter(c => MediaRecorder.isTypeSupported(c.mime));
  }, []);

  const supportedFormats = useMemo(() => {
    return Array.from(new Set(availableCodecs.map(c => c.ext)));
  }, [availableCodecs]);

  const [videoConfig, setVideoConfig] = useState<VideoExportConfig>({
    resolution: '720p',
    fps: 30,
    codec: availableCodecs[0]?.mime || 'video/webm',
    format: (availableCodecs[0]?.ext as 'mp4' | 'webm') || 'webm',
    watermarkEnabled: true,
    watermarkText: 'HealthCare Studio',
    watermarkPosition: 'bottom-right'
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [slideSyncStatuses, setSlideSyncStatuses] = useState<Record<string, SlideSyncInfo>>({});
  
  const [handbook, setHandbook] = useState<HealthHandbook | null>(null);
  const [showFiltersId, setShowFiltersId] = useState<string | null>(null);
  
  const [history, setHistory] = useState<HealthHandbook[]>([]);
  const [redoStack, setRedoStack] = useState<HealthHandbook[]>([]);

  const [library, setLibrary] = useState<HealthHandbook[]>([]);
  const [assets, setAssets] = useState<HealthAsset[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [libSearch, setLibSearch] = useState('');
  const [libFilterCategory, setLibFilterCategory] = useState('All');
  const [libSortBy, setLibSortBy] = useState<SortOption>('date-desc');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const [isBgMusicMuted, setIsBgMusicMuted] = useState(false);
  const setupMusicRef = useRef<HTMLAudioElement | null>(null);
  const [previewingMusicId, setPreviewingMusicId] = useState<string | null>(null);

  useEffect(() => {
    requestPersistence();
    refreshLibrary();
    refreshAssets();

    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (setupMusicRef.current) setupMusicRef.current.pause();
    };
  }, []);

  const refreshLibrary = async () => {
    const data = await getAllHandbooks();
    setLibrary(data);
  };

  const refreshAssets = async () => {
    const data = await getAllAssets();
    setAssets(data.sort((a, b) => b.createdAt - a.createdAt));
  };

  const handlePreviewSetupMusic = (music: typeof PRESET_MUSIC[0]) => {
    if (previewingMusicId === music.id) {
      if (setupMusicRef.current) setupMusicRef.current.pause();
      setPreviewingMusicId(null);
      return;
    }
    if (setupMusicRef.current) setupMusicRef.current.pause();
    if (music.url) {
      const audio = new Audio(music.url);
      audio.loop = true;
      audio.volume = 0.5;
      audio.play();
      setupMusicRef.current = audio;
      setPreviewingMusicId(music.id);
      setSetupData(prev => ({ ...prev, bgMusicUrl: music.url }));
    } else {
      setPreviewingMusicId(null);
      setSetupData(prev => ({ ...prev, bgMusicUrl: '' }));
    }
  };

  const filteredLibrary = useMemo(() => {
    let result = [...library];
    if (libSearch) result = result.filter(h => h.title.toLowerCase().includes(libSearch.toLowerCase()));
    if (libFilterCategory !== 'All') result = result.filter(h => h.category === libFilterCategory);
    result.sort((a, b) => {
      switch (libSortBy) {
        case 'date-desc': return b.createdAt - a.createdAt;
        case 'date-asc': return a.createdAt - b.createdAt;
        case 'title-asc': return a.title.localeCompare(b.title);
        case 'category-asc': return a.category.localeCompare(b.category);
        default: return 0;
      }
    });
    return result;
  }, [library, libSearch, libFilterCategory, libSortBy]);

  const pushToHistory = (currentHandbook: HealthHandbook) => {
    setHistory(prev => {
      const newHistory = [...prev, JSON.parse(JSON.stringify(currentHandbook))];
      if (newHistory.length > MAX_HISTORY) return newHistory.slice(1);
      return newHistory;
    });
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (history.length === 0 || !handbook) return;
    const previousState = history[history.length - 1];
    setRedoStack(prev => [...prev, JSON.parse(JSON.stringify(handbook))]);
    setHistory(prev => prev.slice(0, -1));
    setHandbook(previousState);
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !handbook) return;
    const nextState = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(handbook))]);
    setRedoStack(prev => prev.slice(0, -1));
    setHandbook(nextState);
  };

  const resetToNew = () => {
    if (setupMusicRef.current) setupMusicRef.current.pause();
    setPreviewingMusicId(null);
    setHandbook(null);
    setHistory([]);
    setRedoStack([]);
    setMode(AppMode.SETUP);
    setSetupData({ 
      topic: '', 
      category: HEALTH_CATEGORIES[0], 
      voice: VOICE_OPTIONS[0].id,
      bgMusicUrl: PRESET_MUSIC[1].url,
      transitionSoundUrl: PRESET_SFX[1].url,
      intro: 'Chào mừng bạn đến với cẩm nang sức khỏe. Hôm nay chúng ta sẽ tìm hiểu về...', 
      outro: 'Chúc bạn luôn mạnh khỏe và bình an. Hãy theo dõi để biết thêm nhiều mẹo hữu ích nhé!' 
    });
    setExportStatus('idle');
    setExportedVideoUrl(null);
    setSlideSyncStatuses({});
  };

  const loadFromLibrary = async (item: HealthHandbook, targetMode: AppMode = AppMode.LIVE) => {
    setIsProcessing(true);
    setExportStatus('idle');
    setExportedVideoUrl(null);
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      const allSlides = [item.introSlide, ...item.slides, item.outroSlide];
      imageCacheRef.current.clear();
      await Promise.all(allSlides.map(async (slide) => {
        if (slide.audioData && !slide.audioBuffer) {
          try {
            slide.audioBuffer = await decodeAudio(slide.audioData, ctx);
          } catch (e) { console.warn("Lỗi decode âm thanh slide:", slide.id); }
        }
        if (slide.imageUrl && !imageCacheRef.current.has(slide.imageUrl)) {
          await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = slide.imageUrl!;
            img.onload = () => { imageCacheRef.current.set(slide.imageUrl!, img); resolve(true); };
            img.onerror = () => resolve(false);
          });
        }
      }));
      setHandbook(item);
      setHistory([]);
      setRedoStack([]);
      setMode(targetMode);
      setCurrentSlideIndex(0);
    } catch (e) {
      alert("Không thể tải cẩm nang.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddAsset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const url = ev.target?.result as string;
        const newAsset: HealthAsset = {
          id: Date.now().toString(),
          label: file.name.split('.')[0],
          imageUrl: url,
          createdAt: Date.now()
        };
        await saveAssetToDB(newAsset);
        await refreshAssets();
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateHandbook = async () => {
    if (!setupData.topic.trim()) return;
    if (setupMusicRef.current) setupMusicRef.current.pause();
    setIsProcessing(true);
    try {
      const currentAssets = await getAllAssets(); 
      const assetLabels = currentAssets.map(a => a.label);
      const result = await generateHealthContent(setupData.topic, setupData.category, assetLabels);
      const matchedSlides = result.slides.map(s => {
        const textLower = (s.text || "").toLowerCase();
        const promptLower = (s.imagePrompt || "").toLowerCase();
        const matchedAsset = currentAssets.find(asset => {
          const label = asset.label.toLowerCase().trim();
          if (label.length < 2) return false;
          return textLower.includes(label) || promptLower.includes(label);
        });
        return {
          id: Math.random().toString(36).substr(2, 9),
          text: s.text || "",
          imagePrompt: s.imagePrompt || "",
          imageUrl: matchedAsset?.imageUrl, 
          isUserUploaded: !!matchedAsset,
          links: [],
          brightness: 100,
          contrast: 100
        };
      });
      const newHandbook: HealthHandbook = {
        id: Date.now().toString(),
        title: result.title,
        category: setupData.category,
        voice: setupData.voice,
        introSlide: { id: 'intro', text: setupData.intro, imagePrompt: 'Medical clinic entrance background professional aesthetic', links: [], brightness: 100, contrast: 100 },
        outroSlide: { id: 'outro', text: setupData.outro, imagePrompt: 'Healthy people smiling clean background high quality', links: [], brightness: 100, contrast: 100 },
        slides: matchedSlides,
        createdAt: Date.now(),
        bgMusicVolume: 0.3,
        bgMusicUrl: setupData.bgMusicUrl,
        transitionSoundUrl: setupData.transitionSoundUrl,
        voiceSpeed: 1.0,
        voicePitch: 0,
        voiceVolume: 1.0,
        references: []
      };
      setHandbook(newHandbook);
      setHistory([]);
      setRedoStack([]);
      setMode(AppMode.CONTENT);
      setSlideSyncStatuses({});
    } catch (error) {
      alert("Lỗi tạo nội dung.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!handbook) return;
    setIsProcessing(true);
    try {
      await saveHandbookToDB(handbook);
      await refreshLibrary();
      alert("Đã lưu bản nháp vào thư viện!");
    } catch (e) {
      alert("Lỗi khi lưu bản nháp.");
    } finally {
      setIsProcessing(false);
    }
  };

  const addSampleSlide = () => {
    if (!handbook) return;
    pushToHistory(handbook);
    const newSlide: HealthSlide = {
      id: Math.random().toString(36).substr(2, 9),
      text: "Nhập nội dung bước hướng dẫn mới tại đây...",
      imagePrompt: "Professional healthcare illustration, clean medical aesthetic, high fidelity, 8k",
      links: [],
      brightness: 100,
      contrast: 100
    };
    setHandbook({ ...handbook, slides: [...handbook.slides, newSlide] });
    setSlideSyncStatuses(prev => ({ ...prev, [newSlide.id]: { status: 'idle' } }));
  };

  const handleFinalize = async () => {
    if (!handbook) return;
    setIsSyncing(true);
    const allSlides = [handbook.introSlide, ...handbook.slides, handbook.outroSlide];
    
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      const { voice } = handbook;

      // Xử lý song song tất cả các slide để tăng tốc độ tối đa
      await Promise.all(allSlides.map(async (slide) => {
        setSlideSyncStatuses(prev => ({ ...prev, [slide.id]: { status: 'syncing', progressMessage: 'Đang chuẩn bị...' } }));
        try {
          // 1. Tạo ảnh nếu chưa có
          if (!slide.imageUrl) {
            setSlideSyncStatuses(prev => ({ ...prev, [slide.id]: { status: 'syncing', progressMessage: 'Đang tạo ảnh AI...' } }));
            slide.imageUrl = await generateHealthImage(slide.imagePrompt);
          }
          // 2. Tạo giọng đọc nếu chưa có
          if (!slide.audioData) {
            setSlideSyncStatuses(prev => ({ ...prev, [slide.id]: { status: 'syncing', progressMessage: 'Đang tạo giọng đọc...' } }));
            slide.audioData = await generateHealthVoice(slide.text, voice);
          }
          // 3. Giải mã âm thanh
          if (slide.audioData && !slide.audioBuffer) {
            slide.audioBuffer = await decodeAudio(slide.audioData, ctx);
          }
          // 4. Cache ảnh vào bộ nhớ Canvas
          if (slide.imageUrl && !imageCacheRef.current.has(slide.imageUrl)) {
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.src = slide.imageUrl!;
              img.onload = () => { imageCacheRef.current.set(slide.imageUrl!, img); resolve(true); };
              img.onerror = () => reject(new Error("Lỗi tải ảnh"));
            });
          }
          setSlideSyncStatuses(prev => ({ ...prev, [slide.id]: { status: 'success' } }));
        } catch (err: any) {
          setSlideSyncStatuses(prev => ({ ...prev, [slide.id]: { status: 'error', error: err.message } }));
          throw err; // Ngắt Promise.all nếu có lỗi nghiêm trọng
        }
      }));

      await saveHandbookToDB(handbook);
      refreshLibrary();
      setMode(AppMode.LIVE);
      setCurrentSlideIndex(0);
      animationStartTimeRef.current = performance.now();
    } catch (error) {
      alert("Quá trình đồng bộ gặp lỗi. Vui lòng kiểm tra các slide báo đỏ.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImageUpload = (slideId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && handbook) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const url = ev.target?.result as string;
        pushToHistory(handbook);
        
        const updateSlide = (s: HealthSlide) => ({ ...s, imageUrl: url, isUserUploaded: true });

        if (slideId === 'intro') {
          setHandbook({ ...handbook, introSlide: updateSlide(handbook.introSlide) });
        } else if (slideId === 'outro') {
          setHandbook({ ...handbook, outroSlide: updateSlide(handbook.outroSlide) });
        } else {
          setHandbook({ ...handbook, slides: handbook.slides.map(s => s.id === slideId ? updateSlide(s) : s) });
        }
        
        // Cập nhật cache ngay lập tức
        const img = new Image();
        img.src = url;
        img.onload = () => imageCacheRef.current.set(url, img);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && handbook) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        pushToHistory(handbook);
        setHandbook({ ...handbook, bgMusicUrl: url });
        if (isPlaying) startBackgroundMusic(audioContextRef.current!, audioContextRef.current!.destination);
      };
      reader.readAsDataURL(file);
    }
  };

  const regenerateSlideImage = async (slideId: string) => {
    if (!handbook) return;
    const allSlides = [handbook.introSlide, ...handbook.slides, handbook.outroSlide];
    const slide = allSlides.find(s => s.id === slideId);
    if (!slide) return;
    setSlideSyncStatuses(prev => ({ ...prev, [slideId]: { status: 'syncing', progressMessage: 'Đang tạo lại ảnh AI...' } }));
    try {
      const newUrl = await generateHealthImage(slide.imagePrompt);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = newUrl;
      await new Promise((resolve) => { img.onload = () => { imageCacheRef.current.set(newUrl, img); resolve(true); }; });
      pushToHistory(handbook);
      if (slideId === 'intro') {
        setHandbook({ ...handbook, introSlide: { ...handbook.introSlide, imageUrl: newUrl, isUserUploaded: false } });
      } else if (slideId === 'outro') {
        setHandbook({ ...handbook, outroSlide: { ...handbook.outroSlide, imageUrl: newUrl, isUserUploaded: false } });
      } else {
        const newSlides = handbook.slides.map(s => s.id === slideId ? { ...s, imageUrl: newUrl, isUserUploaded: false } : s);
        setHandbook({ ...handbook, slides: newSlides });
      }
      setSlideSyncStatuses(prev => ({ ...prev, [slideId]: { status: 'success' } }));
    } catch (err: any) {
      setSlideSyncStatuses(prev => ({ ...prev, [slideId]: { status: 'error', error: err.message } }));
    }
  };

  const updateSlideImageFilter = (slideId: string, type: 'brightness' | 'contrast', value: number) => {
    if (!handbook) return;
    if (slideId === 'intro') {
      setHandbook({ ...handbook, introSlide: { ...handbook.introSlide, [type]: value } });
    } else if (slideId === 'outro') {
      setHandbook({ ...handbook, outroSlide: { ...handbook.outroSlide, [type]: value } });
    } else {
      const newSlides = handbook.slides.map(s => s.id === slideId ? { ...s, [type]: value } : s);
      setHandbook({ ...handbook, slides: newSlides });
    }
  };

  const resetSlideFilters = (slideId: string) => {
    if (!handbook) return;
    pushToHistory(handbook);
    const update = (s: HealthSlide) => ({ ...s, brightness: 100, contrast: 100 });
    if (slideId === 'intro') {
      setHandbook({ ...handbook, introSlide: update(handbook.introSlide) });
    } else if (slideId === 'outro') {
      setHandbook({ ...handbook, outroSlide: update(handbook.outroSlide) });
    } else {
      setHandbook({ ...handbook, slides: handbook.slides.map(s => s.id === slideId ? update(s) : s) });
    }
  };

  const startRecording = async (slideId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const base64 = ev.target?.result as string;
          updateSlideAudio(slideId, base64);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setRecordingSlideId(slideId);
    } catch (err) { alert("Không thể truy cập microphone."); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setRecordingSlideId(null);
    }
  };

  const handleSlideAudioUpload = (slideId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        updateSlideAudio(slideId, base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const updateSlideAudio = (slideId: string, base64: string) => {
    if (!handbook) return;
    pushToHistory(handbook);
    if (slideId === 'intro') {
      setHandbook({ ...handbook, introSlide: { ...handbook.introSlide, audioData: base64, audioBuffer: undefined } });
    } else if (slideId === 'outro') {
      setHandbook({ ...handbook, outroSlide: { ...handbook.outroSlide, audioData: base64, audioBuffer: undefined } });
    } else {
      const newSlides = handbook.slides.map(s => s.id === slideId ? { ...s, audioData: base64, audioBuffer: undefined } : s);
      setHandbook({ ...handbook, slides: newSlides });
    }
  };

  const clearSlideAudio = (slideId: string) => {
    if (!handbook) return;
    pushToHistory(handbook);
    if (slideId === 'intro') {
      setHandbook({ ...handbook, introSlide: { ...handbook.introSlide, audioData: undefined, audioBuffer: undefined } });
    } else if (slideId === 'outro') {
      setHandbook({ ...handbook, outroSlide: { ...handbook.outroSlide, audioData: undefined, audioBuffer: undefined } });
    } else {
      const newSlides = handbook.slides.map(s => s.id === slideId ? { ...s, audioData: undefined, audioBuffer: undefined } : s);
      setHandbook({ ...handbook, slides: newSlides });
    }
  };

  const playSFX = async (url: string, ctx: AudioContext, destination: AudioNode) => {
    if (!url) return;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.4;
      source.connect(gainNode);
      gainNode.connect(destination);
      source.start();
    } catch (e) { console.warn("Lỗi phát SFX"); }
  };

  const startBackgroundMusic = async (ctx: AudioContext, destination: AudioNode) => {
    if (!handbook?.bgMusicUrl || handbook.bgMusicUrl === '') return;
    try {
      stopBackgroundMusic();
      const response = await fetch(handbook.bgMusicUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.loop = true;
      const gainNode = ctx.createGain();
      gainNode.gain.value = isBgMusicMuted ? 0 : (handbook.bgMusicVolume || 0.3);
      source.connect(gainNode);
      gainNode.connect(destination);
      source.start();
      bgMusicSourceRef.current = source;
      bgMusicGainRef.current = gainNode;
    } catch (e) { console.warn("Lỗi tải nhạc nền"); }
  };

  const stopBackgroundMusic = () => {
    if (bgMusicSourceRef.current) {
      bgMusicSourceRef.current.stop();
      bgMusicSourceRef.current = null;
    }
  };

  const toggleBgMusic = () => {
    const nextMuted = !isBgMusicMuted;
    setIsBgMusicMuted(nextMuted);
    if (bgMusicGainRef.current && audioContextRef.current) {
      const targetGain = nextMuted ? 0 : (handbook?.bgMusicVolume || 0.3);
      bgMusicGainRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.1);
    }
  };

  const testVoice = async () => {
    if (!handbook) return;
    setIsProcessing(true);
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      const testText = "Chào bạn, đây là thử nghiệm âm lượng và tốc độ giọng đọc mà bạn đã chọn.";
      const audioData = await generateHealthVoice(testText, handbook.voice);
      const buffer = await decodeAudio(audioData, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = handbook.voiceSpeed || 1.0;
      if (source.detune) source.detune.value = (handbook.voicePitch || 0) * 100;
      const voiceGainNode = ctx.createGain();
      voiceGainNode.gain.value = handbook.voiceVolume ?? 1.0;
      source.connect(voiceGainNode);
      voiceGainNode.connect(ctx.destination);
      source.start();
    } catch (e) { alert("Lỗi phát thử giọng đọc."); } finally { setIsProcessing(false); }
  };

  const playSequence = async (startIndex: number, useDestination: boolean, onComplete: () => void) => {
    if (!handbook) return;
    const totalCount = handbook.slides.length + 2;
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    const destination = useDestination && audioDestinationRef.current ? audioDestinationRef.current : ctx.destination;

    if (startIndex === 0) {
      await startBackgroundMusic(ctx, destination);
      if (useDestination) startBackgroundMusic(ctx, ctx.destination);
    } else {
      if (handbook.transitionSoundUrl) {
        playSFX(handbook.transitionSoundUrl, ctx, destination);
      }
    }

    if (startIndex >= totalCount) {
      setIsPlaying(false);
      stopBackgroundMusic();
      onComplete();
      return;
    }

    const slide = startIndex === 0 ? handbook.introSlide : 
                  startIndex === totalCount - 1 ? handbook.outroSlide : 
                  handbook.slides[startIndex - 1];

    if (slide.audioBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = slide.audioBuffer;
      source.playbackRate.value = handbook.voiceSpeed || 1.0;
      if (source.detune) source.detune.value = (handbook.voicePitch || 0) * 100;
      const voiceGainNode = ctx.createGain();
      voiceGainNode.gain.value = handbook.voiceVolume ?? 1.0;
      source.connect(voiceGainNode);
      voiceGainNode.connect(destination);
      if (useDestination) voiceGainNode.connect(ctx.destination);
      source.onended = () => playSequence(startIndex + 1, useDestination, onComplete);
      setCurrentSlideIndex(startIndex);
      animationStartTimeRef.current = performance.now();
      source.start();
      setIsPlaying(true);
      if (exportStatus === 'recording') setExportProgress(Math.round((startIndex / totalCount) * 100));
    } else {
      setCurrentSlideIndex(startIndex);
      animationStartTimeRef.current = performance.now();
      setTimeout(() => playSequence(startIndex + 1, useDestination, onComplete), 3000);
    }
  };

  const exportVideo = async () => {
    if (!handbook || !canvasRef.current) return;
    setExportStatus('preparing');
    setExportedVideoUrl(null);
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      audioDestinationRef.current = ctx.createMediaStreamDestination();
      const bitRate = videoConfig.resolution === '1080p' ? 12000000 : 8000000;
      const combinedStream = new MediaStream([
        ...canvasRef.current.captureStream(videoConfig.fps).getVideoTracks(),
        ...audioDestinationRef.current.stream.getAudioTracks()
      ]);
      const recorder = new MediaRecorder(combinedStream, { mimeType: videoConfig.codec, videoBitsPerSecond: bitRate });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const mime = videoConfig.codec.split(';')[0];
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        setExportedVideoUrl(url); 
        const a = document.createElement('a');
        a.href = url;
        a.download = `${handbook.title.replace(/\s+/g, '_')}_HealthGuide.${videoConfig.format}`;
        a.click();
        setExportStatus('success');
      };
      setExportStatus('recording');
      recorder.start();
      await playSequence(0, true, () => {
        setTimeout(() => recorder.state === 'recording' && recorder.stop(), 1000);
      });
    } catch (err) { setExportStatus('error'); }
  };

  useEffect(() => {
    if (mode === AppMode.LIVE && canvasRef.current) {
      const canvas = canvasRef.current;
      const targetWidth = videoConfig.resolution === '1080p' ? 1920 : 1280;
      const targetHeight = videoConfig.resolution === '1080p' ? 1080 : 720;
      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      let animId: number;

      const getSlideByIndex = (idx: number) => {
        if (!handbook) return null;
        if (idx === 0) return handbook.introSlide;
        if (idx === handbook.slides.length + 1) return handbook.outroSlide;
        return handbook.slides[idx - 1];
      };

      const drawImageWithEffect = (slide: HealthSlide, alpha: number, progress: number, isPrev: boolean) => {
        if (!slide?.imageUrl) return;
        const img = imageCacheRef.current.get(slide.imageUrl);
        if (!img) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        const brightness = slide.brightness !== undefined ? slide.brightness : 100;
        const contrast = slide.contrast !== undefined ? slide.contrast : 100;
        ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;

        const ratio = Math.max(canvas.width / img.width, canvas.height / img.height);
        
        const slideOffset = isPrev ? (-80 * progress) : (80 * (1 - progress));
        const scaleBase = 1.05;
        const zoomEffect = isPrev ? (0.08 * progress) : (-0.08 * progress);
        const scale = scaleBase + zoomEffect;

        const w = img.width * ratio * scale;
        const h = img.height * ratio * scale;
        
        ctx.drawImage(img, (canvas.width - w) / 2 + slideOffset, (canvas.height - h) / 2, w, h);
        ctx.restore();
      };

      const drawTextOverlay = (slide: HealthSlide, alpha: number, progress: number) => {
        if (!slide) return;
        const scaleFactor = canvas.width / 1280;
        const overlayHeight = 180 * scaleFactor;
        const isBottom = textConfig.position === 'bottom';
        const rectY = isBottom ? canvas.height - overlayHeight : 0;
        
        const gradient = ctx.createLinearGradient(0, rectY + (isBottom ? 0 : overlayHeight), 0, rectY + (isBottom ? overlayHeight : 0));
        gradient.addColorStop(0, `rgba(255, 255, 255, ${textConfig.opacity * alpha})`);
        gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
        
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, rectY, canvas.width, overlayHeight);
        
        ctx.globalAlpha = alpha * textConfig.opacity;
        ctx.fillStyle = "white";
        const barHeight = overlayHeight * 0.8;
        ctx.fillRect(0, isBottom ? canvas.height - barHeight : 0, canvas.width, barHeight);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#0f172a";
        const currentFontSize = textConfig.fontSize * scaleFactor;
        ctx.font = `bold ${currentFontSize}px ${textConfig.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const words = (slide.text || "").split(' ');
        let line = '';
        let currentY = isBottom ? canvas.height - (barHeight / 2) - (10 * scaleFactor) : (barHeight / 2) + (10 * scaleFactor);
        const maxWidth = canvas.width - (160 * scaleFactor);
        
        for(let n = 0; n < words.length; n++) {
          let testLine = line + words[n] + ' ';
          if (ctx.measureText(testLine).width > maxWidth) {
            ctx.fillText(line, canvas.width / 2, currentY);
            line = words[n] + ' ';
            currentY += currentFontSize + (12 * scaleFactor);
          } else line = testLine;
        }
        ctx.fillText(line, canvas.width / 2, currentY);
        ctx.restore();
      };

      const drawWatermark = () => {
        if (!videoConfig.watermarkEnabled) return;
        const scaleFactor = canvas.width / 1280;
        ctx.save();
        const wmFontSize = 20 * scaleFactor;
        ctx.font = `500 ${wmFontSize}px Poppins`;
        const wmText = videoConfig.watermarkText || "HealthCare Studio";
        const wmPadding = 30 * scaleFactor;
        const wmMetrics = ctx.measureText(wmText);
        const wmBgPadding = 12 * scaleFactor;
        
        let wmx, wmy;
        switch (videoConfig.watermarkPosition) {
          case 'top-left': wmx = wmPadding; wmy = wmPadding + wmFontSize; break;
          case 'top-right': wmx = canvas.width - wmMetrics.width - wmPadding; wmy = wmPadding + wmFontSize; break;
          case 'bottom-left': wmx = wmPadding; wmy = canvas.height - wmPadding; break;
          case 'bottom-right':
          default: wmx = canvas.width - wmMetrics.width - wmPadding; wmy = canvas.height - wmPadding; break;
        }

        ctx.fillStyle = "rgba(15, 23, 42, 0.4)";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(wmx - wmBgPadding, wmy - wmFontSize - wmBgPadding/2, wmMetrics.width + wmBgPadding * 2, wmFontSize + wmBgPadding, 8 * scaleFactor);
        } else {
          ctx.rect(wmx - wmBgPadding, wmy - wmFontSize - wmBgPadding/2, wmMetrics.width + wmBgPadding * 2, wmFontSize + wmBgPadding);
        }
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillText(wmText, wmx, wmy - wmFontSize * 0.1);
        ctx.restore();
      };

      const draw = () => {
        const now = performance.now();
        const elapsed = now - animationStartTimeRef.current;
        const transDuration = 1200; 
        const transProgress = Math.min(1, elapsed / transDuration);
        
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const currentSlide = getSlideByIndex(currentSlideIndex);
        
        if (currentSlideIndex > 0 && transProgress < 1) {
          const prevSlide = getSlideByIndex(currentSlideIndex - 1);
          if (prevSlide) {
            drawImageWithEffect(prevSlide, 1 - transProgress, transProgress, true);
          }
        }
        if (currentSlide) {
          drawImageWithEffect(currentSlide, transProgress, transProgress, false);
          drawTextOverlay(currentSlide, transProgress, transProgress);
        }
        drawWatermark();
        animId = requestAnimationFrame(draw);
      };
      draw();
      return () => cancelAnimationFrame(animId);
    }
  }, [mode, currentSlideIndex, textConfig, handbook, videoConfig]);

  const handleMusicSelect = (url: string) => {
    if (handbook) {
      setHandbook({ ...handbook, bgMusicUrl: url });
      if (isPlaying && audioContextRef.current) startBackgroundMusic(audioContextRef.current, audioContextRef.current.destination);
    }
  };

  const handleSFXSelect = (url: string) => {
    if (handbook) {
      setHandbook({ ...handbook, transitionSoundUrl: url });
      if (url && audioContextRef.current) {
        playSFX(url, audioContextRef.current, audioContextRef.current.destination);
      }
    }
  };

  const handleFormatChange = (f: 'mp4' | 'webm') => {
    const matchingCodec = availableCodecs.find(c => c.ext === f);
    if (matchingCodec) {
      setVideoConfig({...videoConfig, format: f, codec: matchingCodec.mime});
    }
  };

  const totalSlides = handbook ? handbook.slides.length + 2 : 0;
  const currentProgress = totalSlides > 0 ? ((currentSlideIndex + 1) / totalSlides) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#f0f9f9] font-sans text-slate-900">
      <header className="bg-white border-b border-teal-100 p-4 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer text-teal-600" onClick={() => setMode(AppMode.SETUP)}>
            <i className="fas fa-heart-pulse text-2xl animate-pulse"></i>
            <h1 className="text-2xl font-bold tracking-tight">HealthCare AI Studio</h1>
          </div>
          <div className="flex items-center gap-4 relative" ref={notificationRef}>
            {handbook && mode !== AppMode.CONTENT && mode !== AppMode.LIVE && (
              <button onClick={() => setMode(AppMode.CONTENT)} className="bg-orange-500 text-white px-4 py-2 rounded-full font-bold text-xs animate-bounce shadow-lg flex items-center gap-2"><i className="fas fa-edit"></i> Quay lại chỉnh sửa</button>
            )}
            <button onClick={() => setMode(AppMode.ASSETS)} className={`p-2 rounded-full font-bold transition flex items-center gap-2 ${mode === AppMode.ASSETS ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} title="Kho ảnh mẫu (Warehouse)"><i className="fas fa-images"></i></button>
            <button onClick={() => setMode(AppMode.LIBRARY)} className={`px-4 py-2 rounded-full font-bold transition ${mode === AppMode.LIBRARY ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Thư viện</button>
            <button onClick={resetToNew} className="bg-teal-50 text-teal-600 px-4 py-2 rounded-full font-bold hover:bg-teal-100 transition">Tạo mới</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8">
        {mode === AppMode.ASSETS && (
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-8">
              <div><h2 className="text-3xl font-bold text-teal-900">Kho Ảnh Mẫu (Warehouse)</h2><p className="text-slate-500 font-medium">Lưu trữ ảnh đặc trưng của bạn để AI tự động khớp khi tạo kịch bản.</p></div>
              <label className="bg-teal-600 text-white px-6 py-3 rounded-full font-bold shadow-xl hover:bg-teal-700 cursor-pointer transition flex items-center gap-2"><i className="fas fa-upload"></i> Thêm ảnh mẫu<input type="file" className="hidden" accept="image/*" onChange={handleAddAsset} /></label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {assets.map(asset => (
                <div key={asset.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border group">
                  <div className="aspect-square relative overflow-hidden bg-slate-100"><img src={asset.imageUrl} className="w-full h-full object-cover" alt="Asset" /><button onClick={async () => { await deleteAssetFromDB(asset.id); await refreshAssets(); }} className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition flex items-center justify-center shadow-lg"><i className="fas fa-times text-[10px]"></i></button></div>
                  <div className="p-3"><input value={asset.label} onChange={async e => { const updated = {...asset, label: e.target.value}; await saveAssetToDB(updated); setAssets(assets.map(a => a.id === asset.id ? updated : a)); }} className="w-full text-xs font-bold text-teal-800 outline-none border-b border-transparent focus:border-teal-300" placeholder="Nhãn..." /></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === AppMode.LIBRARY && (
          <div className="animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
              <h2 className="text-3xl font-bold text-teal-900">Thư viện cẩm nang</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredLibrary.map(item => (
                <div key={item.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-xl transition-all group flex flex-col">
                    <div className="aspect-video relative bg-slate-100 overflow-hidden"><img src={item.coverImageUrl || item.introSlide.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" alt="Cover" /><div className="absolute top-4 left-4 bg-teal-600 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg">{item.category}</div><button onClick={async e => { e.stopPropagation(); await deleteHandbookFromDB(item.id); await refreshLibrary(); }} className="absolute top-4 right-4 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-red-500 opacity-0 group-hover:opacity-100 transition"><i className="fas fa-trash-alt text-xs"></i></button><div className="absolute inset-0 bg-teal-900/40 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4"><button onClick={() => loadFromLibrary(item, AppMode.LIVE)} className="w-14 h-14 bg-white text-teal-600 rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition"><i className="fas fa-play text-xl ml-1"></i></button><button onClick={() => loadFromLibrary(item, AppMode.CONTENT)} className="w-14 h-14 bg-teal-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition"><i className="fas fa-edit text-xl"></i></button></div></div>
                    <div className="p-6 flex-1 flex flex-col"><h3 className="font-bold text-lg text-slate-800 line-clamp-1">{item.title}</h3></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === AppMode.SETUP && (
          <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-3xl mx-auto border-t-8 border-teal-500 animate-fadeIn">
            <h2 className="text-3xl font-bold mb-2 text-center text-teal-800">Khởi tạo cẩm nang</h2>
            <div className="space-y-8">
              <div><label className="block text-sm font-bold text-slate-600 uppercase mb-2">Chủ đề mong muốn</label><textarea value={setupData.topic} onChange={e => setSetupData({...setupData, topic: e.target.value})} className="w-full h-28 p-4 rounded-2xl border-2 border-slate-100 focus:border-teal-500 outline-none transition resize-none font-medium text-lg" placeholder="Ví dụ: Chế độ ăn cho người cao huyết áp..." /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div><label className="block text-sm font-bold text-slate-600 uppercase mb-2">Danh mục</label><select value={setupData.category} onChange={e => setSetupData({...setupData, category: e.target.value})} className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-teal-500 outline-none bg-white font-bold text-slate-700">{HEALTH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div><label className="block text-sm font-bold text-slate-600 uppercase mb-2">Giọng đọc AI</label><select value={setupData.voice} onChange={e => setSetupData({...setupData, voice: e.target.value})} className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-teal-500 outline-none bg-white font-bold text-slate-700">{VOICE_OPTIONS.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-600 uppercase mb-4">Nhạc nền (Có thể tải nhạc riêng)</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {PRESET_MUSIC.map(m => (
                    <button key={m.id} onClick={() => handlePreviewSetupMusic(m)} className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all relative group ${setupData.bgMusicUrl === m.url ? 'border-teal-500 bg-teal-50 text-teal-600' : 'border-slate-50 bg-slate-50 hover:bg-slate-100 text-slate-400'}`}>
                      <i className={`fas ${m.icon} text-xl mb-2`}></i><span className="text-[10px] font-black uppercase text-center">{m.name}</span>
                      {m.url && (<div className={`mt-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${previewingMusicId === m.id ? 'bg-teal-600 text-white' : 'bg-white text-slate-400 group-hover:text-teal-500'}`}><i className={`fas ${previewingMusicId === m.id ? 'fa-pause' : 'fa-play'} text-[10px]`}></i></div>)}
                    </button>
                  ))}
                  <label className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-slate-300 hover:bg-teal-50 cursor-pointer transition-all">
                    <i className="fas fa-upload text-xl mb-2 text-teal-600"></i>
                    <span className="text-[10px] font-black uppercase text-teal-600">Tải nhạc</span>
                    <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
                  </label>
                </div>
              </div>
              <button onClick={handleCreateHandbook} disabled={isProcessing} className="w-full bg-teal-600 text-white py-5 rounded-3xl font-bold text-xl hover:bg-teal-700 transition shadow-xl disabled:opacity-50 flex items-center justify-center gap-4 active:scale-[0.98]">{isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic"></i>}Bắt đầu tạo cẩm nang AI</button>
            </div>
          </div>
        )}

        {mode === AppMode.CONTENT && handbook && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-3xl shadow-sm border border-teal-50 gap-4 sticky top-20 z-40">
               <div className="flex-1"><h2 className="text-2xl font-bold text-slate-800">{handbook.title}</h2><p className="text-xs text-teal-600 font-bold uppercase tracking-widest">{handbook.category}</p></div>
               <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                 <button onClick={handleUndo} disabled={history.length === 0} className="w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition disabled:opacity-30"><i className="fas fa-undo"></i></button>
                 <button onClick={addSampleSlide} disabled={isSyncing || isProcessing} className="bg-teal-50 text-teal-700 px-6 py-3 rounded-full font-bold hover:bg-teal-100 transition border border-teal-200">Thêm Slide</button>
                 <button onClick={handleFinalize} disabled={isSyncing} className={`flex-1 md:flex-none px-8 py-3 rounded-full font-bold shadow-xl transition ${isSyncing ? 'bg-slate-400' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}>{isSyncing ? 'Đang tạo video...' : 'Xác nhận kịch bản'}</button>
               </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {[handbook.introSlide, ...handbook.slides, handbook.outroSlide].map((slide, idx) => (
                   <div key={idx} className={`bg-white p-6 rounded-3xl border shadow-sm relative group flex flex-col transition-all ${slideSyncStatuses[slide.id]?.status === 'error' ? 'border-red-500' : 'border-slate-100'}`}>
                      <div className="flex justify-between mb-4">
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{idx === 0 ? 'MỞ ĐẦU' : idx === handbook.slides.length + 1 ? 'KẾT THÚC' : `BƯỚC ${idx}`}</span>
                        <div className="flex gap-2">
                           <label className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center cursor-pointer hover:bg-blue-100" title="Tải ảnh lên">
                             <i className="fas fa-file-image text-xs"></i>
                             <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(slide.id, e)} />
                           </label>
                           <button onClick={() => setShowFiltersId(showFiltersId === slide.id ? null : slide.id)} className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-teal-50 hover:text-teal-600 transition"><i className="fas fa-sliders text-xs"></i></button>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <textarea value={slide.text} onChange={e => { const val = e.target.value; if (idx === 0) setHandbook({...handbook, introSlide: {...handbook.introSlide, text: val}}); else if (idx === handbook.slides.length + 1) setHandbook({...handbook, outroSlide: {...handbook.outroSlide, text: val}}); else setHandbook({...handbook, slides: handbook.slides.map(s => s.id === slide.id ? { ...s, text: val } : s)}); }} className="w-full p-3 h-20 text-xs rounded-xl border border-slate-100 focus:border-teal-300 outline-none resize-none font-medium" placeholder="Nội dung..." />
                        
                        <div className="aspect-video overflow-hidden rounded-2xl bg-slate-50 border relative group/img shadow-inner">
                           {slide.imageUrl ? <img src={slide.imageUrl} className="w-full h-full object-cover" style={{ filter: `brightness(${slide.brightness || 100}%) contrast(${slide.contrast || 100}%)` }} alt="Slide" /> : <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1"><i className="fas fa-image text-2xl"></i><span className="text-[8px] font-bold">CHƯA CÓ ẢNH</span></div>}
                           <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <button onClick={() => recordingSlideId === slide.id ? stopRecording() : startRecording(slide.id)} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${recordingSlideId === slide.id ? 'bg-red-500 animate-pulse' : 'bg-teal-600'}`}><i className={`fas ${recordingSlideId === slide.id ? 'fa-stop' : 'fa-microphone'}`}></i></button>
                              <label className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white cursor-pointer hover:bg-blue-700 transition shadow-lg"><i className="fas fa-upload"></i><input type="file" accept="audio/*" className="hidden" onChange={(e) => handleSlideAudioUpload(slide.id, e)} /></label>
                           </div>
                           {slideSyncStatuses[slide.id]?.status === 'syncing' && <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-center"><div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-2"></div><span className="text-[9px] font-bold text-teal-800">{slideSyncStatuses[slide.id]?.progressMessage}</span></div>}
                        </div>

                        {showFiltersId === slide.id && (
                          <div className="p-3 bg-teal-50/50 rounded-xl border border-teal-100 space-y-3 animate-fadeIn">
                             <div className="flex justify-between items-center"><span className="text-[10px] font-black text-teal-700 uppercase">Bộ lọc</span><button onClick={() => resetSlideFilters(slide.id)} className="text-[8px] text-orange-600 font-bold">Đặt lại</button></div>
                             <div className="space-y-2">
                                <div className="flex justify-between text-[8px] font-bold text-teal-800"><span>Độ sáng</span><span>{slide.brightness || 100}%</span></div>
                                <input type="range" min="50" max="150" value={slide.brightness || 100} onChange={e => updateSlideImageFilter(slide.id, 'brightness', parseInt(e.target.value))} className="w-full h-1 bg-white rounded-lg appearance-none accent-teal-600" />
                                <div className="flex justify-between text-[8px] font-bold text-teal-800"><span>Tương phản</span><span>{slide.contrast || 100}%</span></div>
                                <input type="range" min="50" max="150" value={slide.contrast || 100} onChange={e => updateSlideImageFilter(slide.id, 'contrast', parseInt(e.target.value))} className="w-full h-1 bg-white rounded-lg appearance-none accent-teal-600" />
                             </div>
                          </div>
                        )}
                      </div>
                   </div>
               ))}
            </div>
          </div>
        )}

        {mode === AppMode.LIVE && handbook && (
          <div className="max-w-6xl mx-auto animate-fadeIn">
             <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
               <h2 className="text-3xl font-bold text-teal-900">{handbook.title}</h2>
               <div className="flex gap-3">
                 <button onClick={exportVideo} disabled={exportStatus === 'recording' || isPlaying} className="bg-teal-600 text-white px-8 py-3 rounded-full font-bold shadow-xl flex items-center gap-2 transition hover:bg-teal-700 active:scale-95 disabled:opacity-50"><i className={`fas ${exportStatus === 'recording' ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>Xuất Video</button>
                 <button onClick={() => setMode(AppMode.CONTENT)} className="bg-white border-2 px-6 py-3 rounded-full font-bold hover:bg-slate-50 transition text-slate-600 shadow-sm">Điều chỉnh lại</button>
               </div>
             </div>
             <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <div className="lg:col-span-3 space-y-4">
                   <div className="relative rounded-[2.5rem] overflow-hidden bg-black shadow-2xl aspect-video border-[10px] border-white ring-1 ring-slate-100 group">
                      <canvas ref={canvasRef} className="w-full h-full" />
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-200/50 overflow-hidden"><div className="h-full bg-teal-500 transition-all duration-700 ease-out" style={{ width: `${currentProgress}%` }} /></div>
                      {!isPlaying && exportStatus !== 'recording' && <button onClick={() => playSequence(0, false, () => {})} className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-all"><div className="w-20 h-20 bg-teal-600 rounded-full flex items-center justify-center text-white text-3xl shadow-2xl group-hover:scale-110 transition active:scale-95"><i className="fas fa-play"></i></div></button>}
                   </div>
                </div>
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl shadow-md border border-teal-50">
                    <h3 className="font-bold text-lg text-teal-700 border-b pb-2 flex items-center justify-between">Nhạc Nền <button onClick={toggleBgMusic} className="text-teal-600"><i className={`fas ${isBgMusicMuted ? 'fa-volume-mute' : 'fa-volume-up'}`}></i></button></h3>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                       {PRESET_MUSIC.map(m => <button key={m.id} onClick={() => handleMusicSelect(m.url)} className={`p-2 rounded-xl border text-[9px] font-bold ${handbook.bgMusicUrl === m.url ? 'bg-teal-50 border-teal-500 text-teal-600' : 'bg-slate-50 border-transparent text-slate-400'}`}>{m.name}</button>)}
                       <label className="p-2 rounded-xl border border-dashed border-teal-300 bg-teal-50 flex items-center justify-center cursor-pointer"><i className="fas fa-upload text-teal-600 text-[10px]"></i><input type="file" className="hidden" onChange={handleMusicUpload} /></label>
                    </div>
                  </div>
                </div>
             </div>
          </div>
        )}
      </main>

      {showPreviewModal && exportedVideoUrl && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[300] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] overflow-hidden w-full max-w-4xl shadow-2xl relative">
            <video src={exportedVideoUrl} controls autoPlay className="w-full h-full" />
            <div className="p-6 flex justify-center gap-4 bg-white"><button onClick={() => setShowPreviewModal(false)} className="bg-slate-100 text-slate-600 px-10 py-3 rounded-full font-bold">Đóng</button></div>
          </div>
        </div>
      )}
      {(isProcessing || isSyncing) && <div className="fixed inset-0 bg-teal-900/90 backdrop-blur-md z-[200] flex flex-col items-center justify-center text-white p-8 text-center"><div className="w-16 h-16 border-4 border-teal-400 border-t-transparent rounded-full animate-spin mb-4"></div><h3 className="text-xl font-bold">Đang xử lý tài nguyên AI</h3><p className="text-teal-200 text-sm mt-2 max-w-xs font-medium">Hệ thống đang tạo ảnh và giọng đọc song song để tiết kiệm thời gian cho bạn...</p></div>}
    </div>
  );
};

export default App;

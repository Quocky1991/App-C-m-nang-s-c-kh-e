
export interface HealthLink {
  label: string;
  url: string;
}

export interface HealthAsset {
  id: string;
  label: string;
  imageUrl: string;
  createdAt: number;
}

export interface HealthSlide {
  id: string;
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  audioData?: string;
  audioBuffer?: AudioBuffer; // Thêm để lưu buffer đã giải mã sẵn
  isUserUploaded?: boolean;
  links?: HealthLink[];
  brightness?: number; // Mặc định 100
  contrast?: number;   // Mặc định 100
}

export interface HealthHandbook {
  id: string;
  title: string;
  category: string;
  voice: string;
  introSlide: HealthSlide;
  outroSlide: HealthSlide;
  slides: HealthSlide[];
  createdAt: number;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  transitionSoundUrl?: string; // Hiệu ứng âm thanh khi chuyển slide
  coverImageUrl?: string; 
  voiceSpeed?: number;    
  voicePitch?: number;    
  voiceVolume?: number;   // Âm lượng giọng đọc (0.0 - 1.0)
  references?: HealthLink[];
}

export enum AppMode {
  SETUP = 'SETUP',     
  CONTENT = 'CONTENT', 
  LIVE = 'LIVE',
  LIBRARY = 'LIBRARY',
  ASSETS = 'ASSETS' // Chế độ quản lý tài sản
}

export const HEALTH_CATEGORIES = [
  "Dinh dưỡng & Chế độ ăn",
  "Bài tập thể hình & Yoga",
  "Sức khỏe tâm thần",
  "Sơ cứu & Cấp cứu",
  "Kiến thức bệnh học",
  "Chăm sóc da & Làm đẹp",
  "Sức khỏe mẹ và bé",
  "Mẹo sống khỏe mỗi ngày"
];

export const VOICE_OPTIONS = [
  { id: 'Kore', name: 'Giọng Nam - Trầm ấm' },
  { id: 'Puck', name: 'Giọng Nữ - Nhẹ nhàng' },
  { id: 'Charon', name: 'Giọng Nam - Chuyên nghiệp' },
  { id: 'Fenrir', name: 'Giọng Nam - Mạnh mẽ' },
  { id: 'Zephyr', name: 'Giọng Nữ - Truyền cảm' }
];
